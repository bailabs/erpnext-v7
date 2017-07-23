// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

erpnext.TransactionController = erpnext.taxes_and_totals.extend({
	setup: function() {
		this._super();
		frappe.ui.form.on(this.frm.doctype + " Item", "rate", function(frm, cdt, cdn) {
			var item = frappe.get_doc(cdt, cdn);
			frappe.model.round_floats_in(item, ["rate", "price_list_rate"]);

			if(item.price_list_rate) {
				item.discount_percentage = flt((1 - item.rate / item.price_list_rate) * 100.0, precision("discount_percentage", item));
			} else {
				item.discount_percentage = 0.0;
			}

			cur_frm.cscript.set_gross_profit(item);
			cur_frm.cscript.calculate_taxes_and_totals();
		})

		frappe.ui.form.on(this.frm.cscript.tax_table, "rate", function(frm, cdt, cdn) {
			cur_frm.cscript.calculate_taxes_and_totals();
		});

		frappe.ui.form.on(this.frm.cscript.tax_table, "tax_amount", function(frm, cdt, cdn) {
			cur_frm.cscript.calculate_taxes_and_totals();
		});

		frappe.ui.form.on(this.frm.cscript.tax_table, "row_id", function(frm, cdt, cdn) {
			cur_frm.cscript.calculate_taxes_and_totals();
		});

		frappe.ui.form.on(this.frm.cscript.tax_table, "included_in_print_rate", function(frm, cdt, cdn) {
			cur_frm.cscript.set_dynamic_labels();
			cur_frm.cscript.calculate_taxes_and_totals();
		});

		frappe.ui.form.on(this.frm.doctype, "apply_discount_on", function(frm) {
			if(frm.doc.additional_discount_percentage) {
				frm.trigger("additional_discount_percentage");
			} else {
				cur_frm.cscript.calculate_taxes_and_totals();
			}
		});

		frappe.ui.form.on(this.frm.doctype, "additional_discount_percentage", function(frm) {
			if (frm.via_discount_amount) {
				return;
			}

			if(!frm.doc.apply_discount_on) {
				frappe.msgprint(__("Please set 'Apply Additional Discount On'"));
				return
			}

			frm.via_discount_percentage = true;

			if(frm.doc.additional_discount_percentage && frm.doc.discount_amount) {
				// Reset discount amount and net / grand total
				frm.set_value("discount_amount", 0);
			}

			var total = flt(frm.doc[frappe.model.scrub(frm.doc.apply_discount_on)]);
			var discount_amount = flt(total*flt(frm.doc.additional_discount_percentage) / 100,
				precision("discount_amount"));

			frm.set_value("discount_amount", discount_amount);
			delete frm.via_discount_percentage;
		});

		frappe.ui.form.on(this.frm.doctype, "discount_amount", function(frm) {
			frm.cscript.set_dynamic_labels();

			if (!frm.via_discount_percentage) {
				frm.via_discount_amount = true;
				frm.set_value("additional_discount_percentage", 0);
				delete frm.via_discount_amount;
			}

			frm.cscript.calculate_taxes_and_totals();
		});
	},
	onload: function() {
		var me = this;
		if(this.frm.doc.__islocal) {
			var today = get_today(),
				currency = frappe.defaults.get_user_default("currency");

			$.each({
				currency: currency,
				price_list_currency: currency,
				status: "Draft",
				is_subcontracted: "No",
			}, function(fieldname, value) {
				if(me.frm.fields_dict[fieldname] && !me.frm.doc[fieldname])
					me.frm.set_value(fieldname, value);
			});

			if(this.frm.doc.company && !this.frm.doc.amended_from) {
				this.frm.script_manager.trigger("company");
			}
		}

		if(this.frm.fields_dict["taxes"]) {
			this["taxes_remove"] = this.calculate_taxes_and_totals;
		}

		if(this.frm.fields_dict["items"]) {
			this["items_remove"] = this.calculate_taxes_and_totals;
		}

		if(this.frm.fields_dict["recurring_print_format"]) {
			this.frm.set_query("recurring_print_format", function(doc) {
				return{
					filters: [
						['Print Format', 'doc_type', '=', cur_frm.doctype],
					]
				}
			});
		}

		if(this.frm.fields_dict["return_against"]) {
			this.frm.set_query("return_against", function(doc) {
				var filters = {
					"docstatus": 1,
					"is_return": 0,
					"company": doc.company
				};
				if (me.frm.fields_dict["customer"] && doc.customer) filters["customer"] = doc.customer;
				if (me.frm.fields_dict["supplier"] && doc.supplier) filters["supplier"] = doc.supplier;

				return {
					filters: filters
				}
			});
		}
		
		this.setup_quality_inspection();
	},

	setup_quality_inspection: function() {
		if(!in_list(["Delivery Note", "Sales Invoice", "Purchase Receipt", "Purchase Invoice"], this.frm.doc.doctype)) {
			return;
		}
		var me = this;
		var inspection_type = in_list(["Purchase Receipt", "Purchase Invoice"], this.frm.doc.doctype) 
			? "Incoming" : "Outgoing";
			
		var quality_inspection_field = this.frm.get_docfield("items", "quality_inspection");
		quality_inspection_field.get_route_options_for_new_doc = function(row) {
			if(me.frm.is_new()) return;
			return {
				"inspection_type": inspection_type,
				"reference_type": me.frm.doc.doctype,
				"reference_name": me.frm.doc.name,
				"item_code": row.doc.item_code,
				"description": row.doc.description,
				"item_serial_no": row.doc.serial_no ? row.doc.serial_no.split("\n")[0] : null,
				"batch_no": row.doc.batch_no
			}
		}
		
		this.frm.set_query("quality_inspection", "items", function(doc, cdt, cdn) {
			var d = locals[cdt][cdn];
			return {
				filters: {
					docstatus: 1,
					inspection_type: inspection_type,
					item_code: d.item_code
				}
			}
		});
	},

	onload_post_render: function() {
		var me = this;
		if(this.frm.doc.__islocal && !(this.frm.doc.taxes || []).length
			&& !(this.frm.doc.__onload ? this.frm.doc.__onload.load_after_mapping : false)) {
				this.apply_default_taxes();
		} else if(this.frm.doc.__islocal && this.frm.doc.company && this.frm.doc["items"]
			&& !this.frm.doc.is_pos) {
				me.calculate_taxes_and_totals();
		}
		if(frappe.meta.get_docfield(this.frm.doc.doctype + " Item", "item_code")) {
			this.setup_item_selector();
		}
	},

	refresh: function() {
		erpnext.toggle_naming_series();
		erpnext.hide_company();
		this.show_item_wise_taxes();
		this.set_dynamic_labels();
		this.setup_sms();
	},

	apply_default_taxes: function() {
		var me = this;
		var taxes_and_charges_field = frappe.meta.get_docfield(me.frm.doc.doctype, "taxes_and_charges",
			me.frm.doc.name);

		if(taxes_and_charges_field) {
			return frappe.call({
				method: "erpnext.controllers.accounts_controller.get_default_taxes_and_charges",
				args: {
					"master_doctype": taxes_and_charges_field.options
				},
				callback: function(r) {
					if(!r.exc) {
						me.frm.set_value("taxes", r.message);
						me.calculate_taxes_and_totals();
					}
				}
			});
		}
	},

	setup_sms: function() {
		var me = this;
		if(this.frm.doc.docstatus===1 && !in_list(["Lost", "Stopped", "Closed"], this.frm.doc.status)
			&& this.frm.doctype != "Purchase Invoice") {
			this.frm.page.add_menu_item(__('Send SMS'), function() { me.send_sms(); });
		}
	},

	send_sms: function() {
		var sms_man = new SMSManager(this.frm.doc);
	},

	barcode: function(doc, cdt, cdn) {
		var d = locals[cdt][cdn];
		if(d.barcode=="" || d.barcode==null) {
			// barcode cleared, remove item
			d.item_code = "";
		}
		this.item_code(doc, cdt, cdn, true);
	},

	item_code: function(doc, cdt, cdn, from_barcode) {
		var me = this;
		var item = frappe.get_doc(cdt, cdn);

		// clear barcode if setting item (else barcode will take priority)
		if(!from_barcode) {
			item.barcode = null;
		}
		if(item.item_code || item.barcode || item.serial_no) {
			if(!this.validate_company_and_party()) {
				cur_frm.fields_dict["items"].grid.grid_rows[item.idx - 1].remove();
			} else {
				return this.frm.call({
					method: "erpnext.stock.get_item_details.get_item_details",
					child: item,
					args: {
						args: {
							item_code: item.item_code,
							barcode: item.barcode,
							serial_no: item.serial_no,
							warehouse: item.warehouse,
							customer: me.frm.doc.customer,
							supplier: me.frm.doc.supplier,
							currency: me.frm.doc.currency,
							conversion_rate: me.frm.doc.conversion_rate,
							price_list: me.frm.doc.selling_price_list ||
								 me.frm.doc.buying_price_list,
							price_list_currency: me.frm.doc.price_list_currency,
							plc_conversion_rate: me.frm.doc.plc_conversion_rate,
							company: me.frm.doc.company,
							order_type: me.frm.doc.order_type,
							is_pos: cint(me.frm.doc.is_pos),
							is_subcontracted: me.frm.doc.is_subcontracted,
							transaction_date: me.frm.doc.transaction_date || me.frm.doc.posting_date,
							ignore_pricing_rule: me.frm.doc.ignore_pricing_rule,
							doctype: me.frm.doc.doctype,
							name: me.frm.doc.name,
							project: item.project || me.frm.doc.project,
							qty: item.qty
						}
					},

					callback: function(r) {
						if(!r.exc) {
							me.frm.script_manager.trigger("price_list_rate", cdt, cdn);
						}
					}
				});
			}
		}
	},

	serial_no: function(doc, cdt, cdn) {
		var me = this;
		var item = frappe.get_doc(cdt, cdn);

		if (item.serial_no) {
			if (!item.item_code) {
				this.frm.script_manager.trigger("item_code", cdt, cdn);
			}
			else {
				var sr_no = [];

				// Replacing all occurences of comma with carriage return
				var serial_nos = item.serial_no.trim().replace(/,/g, '\n');

				serial_nos = serial_nos.trim().split('\n');

				// Trim each string and push unique string to new list
				for (var x=0; x<=serial_nos.length - 1; x++) {
					if (serial_nos[x].trim() != "" && sr_no.indexOf(serial_nos[x].trim()) == -1) {
						sr_no.push(serial_nos[x].trim());
					}
				}

				// Add the new list to the serial no. field in grid with each in new line
				item.serial_no = "";
				for (var x=0; x<=sr_no.length - 1; x++)
					item.serial_no += sr_no[x] + '\n';

				refresh_field("serial_no", item.name, item.parentfield);
				if(!doc.is_return) {
					frappe.model.set_value(item.doctype, item.name, "qty", sr_no.length);
				}
			}
		}
	},

	validate: function() {
		this.calculate_taxes_and_totals(false);
	},

	company: function() {
		var me = this;
		var set_pricing = function() {
			if(me.frm.doc.company && me.frm.fields_dict.currency) {
				var company_currency = me.get_company_currency();
				var company_doc = frappe.get_doc(":Company", me.frm.doc.company);
				if (!me.frm.doc.currency) {
					me.frm.set_value("currency", company_currency);
				}

				if (me.frm.doc.currency == company_currency) {
					me.frm.set_value("conversion_rate", 1.0);
				}
				if (me.frm.doc.price_list_currency == company_currency) {
					me.frm.set_value('plc_conversion_rate', 1.0);
				}
				if (company_doc.default_letter_head) {
					if(me.frm.fields_dict.letter_head) {
						me.frm.set_value("letter_head", company_doc.default_letter_head);
					}
				}
				if (company_doc.default_terms && me.frm.doc.doctype != "Purchase Invoice" && frappe.meta.has_field(me.frm.doc.doctype, "tc_name")) {
					me.frm.set_value("tc_name", company_doc.default_terms);
				}

				me.frm.script_manager.trigger("currency");
				me.apply_pricing_rule();
			}
		}

		var set_party_account = function(set_pricing) {
			if (in_list(["Sales Invoice", "Purchase Invoice"], me.frm.doc.doctype)) {
				if(me.frm.doc.doctype=="Sales Invoice") {
					var party_type = "Customer";
					var party_account_field = 'debit_to';
				} else {
					var party_type = "Supplier";
					var party_account_field = 'credit_to';
				}

				var party = me.frm.doc[frappe.model.scrub(party_type)];
				if(party) {
					return frappe.call({
						method: "erpnext.accounts.party.get_party_account",
						args: {
							company: me.frm.doc.company,
							party_type: party_type,
							party: party
						},
						callback: function(r) {
							if(!r.exc && r.message) {
								me.frm.set_value(party_account_field, r.message);
								set_pricing();
							}
						}
					});
				} else {
					set_pricing();
				}
			} else {
				set_pricing();
			}

		}

		if (this.frm.doc.posting_date) var date = this.frm.doc.posting_date;
		else var date = this.frm.doc.transaction_date;

		if (frappe.meta.get_docfield(this.frm.doctype, "shipping_address") &&
			in_list(['Purchase Order', 'Purchase Receipt', 'Purchase Invoice'], this.frm.doctype)){
				erpnext.utils.get_shipping_address(this.frm, function(){
					set_party_account(set_pricing);
				})
		}else{
			set_party_account(set_pricing);
		}

		if(this.frm.doc.company) {
			erpnext.last_selected_company = this.frm.doc.company;
		}
	},

	transaction_date: function() {
		if (this.frm.doc.transaction_date) {
			this.frm.transaction_date = this.frm.doc.transaction_date;
			frappe.ui.form.trigger(this.frm.doc.doctype, "currency");
		}
	},

	posting_date: function() {
		var me = this;
		if (this.frm.doc.posting_date) {
			this.frm.posting_date = this.frm.doc.posting_date;

			if ((this.frm.doc.doctype == "Sales Invoice" && this.frm.doc.customer) ||
				(this.frm.doc.doctype == "Purchase Invoice" && this.frm.doc.supplier)) {
				return frappe.call({
					method: "erpnext.accounts.party.get_due_date",
					args: {
						"posting_date": me.frm.doc.posting_date,
						"party_type": me.frm.doc.doctype == "Sales Invoice" ? "Customer" : "Supplier",
						"party": me.frm.doc.doctype == "Sales Invoice" ? me.frm.doc.customer : me.frm.doc.supplier,
						"company": me.frm.doc.company
					},
					callback: function(r, rt) {
						if(r.message) {
							me.frm.set_value("due_date", r.message);
							frappe.ui.form.trigger(me.frm.doc.doctype, "currency");
						}
					}
				})
			} else {
				frappe.ui.form.trigger(me.frm.doc.doctype, "currency");
			}
		}
	},

	get_company_currency: function() {
		return erpnext.get_currency(this.frm.doc.company);
	},

	contact_person: function() {
		erpnext.utils.get_contact_details(this.frm);
	},

	currency: function() {
		/* manqala 19/09/2016: let the translation date be whichever of the transaction_date or posting_date is available */
		var transaction_date = this.frm.doc.transaction_date || this.frm.doc.posting_date;
		/* end manqala */
		
		var me = this;
		this.set_dynamic_labels();

		var company_currency = this.get_company_currency();
		// Added `ignore_pricing_rule` to determine if document is loading after mapping from another doc
		if(this.frm.doc.currency && this.frm.doc.currency !== company_currency
				&& !this.frm.doc.ignore_pricing_rule) {
			this.get_exchange_rate(transaction_date, this.frm.doc.currency, company_currency,
				function(exchange_rate) {
					me.frm.set_value("conversion_rate", exchange_rate);
				});
		} else {
			this.conversion_rate();
		}
	},

	conversion_rate: function() {
		if(this.frm.doc.currency === this.get_company_currency()) {
			this.frm.set_value("conversion_rate", 1.0);
		}
		if(this.frm.doc.currency === this.frm.doc.price_list_currency &&
			this.frm.doc.plc_conversion_rate !== this.frm.doc.conversion_rate) {
				this.frm.set_value("plc_conversion_rate", this.frm.doc.conversion_rate);
		}

		if(flt(this.frm.doc.conversion_rate)>0.0) {
			if(this.frm.doc.ignore_pricing_rule) {
				this.calculate_taxes_and_totals();
			} else if (!this.in_apply_price_list){
				this.apply_price_list();
			}

		}
	},

	get_exchange_rate: function(transaction_date, from_currency, to_currency, callback) {
		return frappe.call({
			method: "erpnext.setup.utils.get_exchange_rate",
			args: {
				transaction_date: transaction_date,
				from_currency: from_currency,
				to_currency: to_currency
			},
			callback: function(r) {
				callback(flt(r.message));
			}
		});
	},

	price_list_currency: function() {
		var me=this;
		this.set_dynamic_labels();

		var company_currency = this.get_company_currency();
		// Added `ignore_pricing_rule` to determine if document is loading after mapping from another doc
		if(this.frm.doc.price_list_currency !== company_currency  && !this.frm.doc.ignore_pricing_rule) {
			this.get_exchange_rate(this.frm.doc.posting_date, this.frm.doc.price_list_currency, company_currency,
				function(exchange_rate) {
					me.frm.set_value("plc_conversion_rate", exchange_rate);
				});
		} else {
			this.plc_conversion_rate();
		}
	},

	plc_conversion_rate: function() {
		if(this.frm.doc.price_list_currency === this.get_company_currency()) {
			this.frm.set_value("plc_conversion_rate", 1.0);
		} else if(this.frm.doc.price_list_currency === this.frm.doc.currency
			&& this.frm.doc.plc_conversion_rate && cint(this.frm.doc.plc_conversion_rate) != 1 &&
			cint(this.frm.doc.plc_conversion_rate) != cint(this.frm.doc.conversion_rate)) {
				this.frm.set_value("conversion_rate", this.frm.doc.plc_conversion_rate);
		}

		if(!this.in_apply_price_list) {
			this.apply_price_list();
		}
	},

	qty: function(doc, cdt, cdn) {
		this.apply_pricing_rule(frappe.get_doc(cdt, cdn), true);
	},

	set_dynamic_labels: function() {
		// What TODO? should we make price list system non-mandatory?
		this.frm.toggle_reqd("plc_conversion_rate",
			!!(this.frm.doc.price_list_name && this.frm.doc.price_list_currency));

		if(this.frm.doc_currency!==this.frm.doc.currency) {
			// reset names only when the currency is different

			var company_currency = this.get_company_currency();
			this.change_form_labels(company_currency);
			this.change_grid_labels(company_currency);
			this.frm.refresh_fields();
			this.frm.doc_currency = this.frm.doc.currency;
		}
	},

	change_form_labels: function(company_currency) {
		var me = this;

		this.frm.set_currency_labels(["base_total", "base_net_total", "base_total_taxes_and_charges",
			"base_discount_amount", "base_grand_total", "base_rounded_total", "base_in_words",
			"base_taxes_and_charges_added", "base_taxes_and_charges_deducted", "total_amount_to_pay",
			"base_paid_amount", "base_write_off_amount", "base_change_amount", "base_operating_cost", 
			"base_raw_material_cost", "base_total_cost", "base_scrap_material_cost"
		], company_currency);

		this.frm.set_currency_labels(["total", "net_total", "total_taxes_and_charges", "discount_amount",
			"grand_total", "taxes_and_charges_added", "taxes_and_charges_deducted",
			"rounded_total", "in_words", "paid_amount", "write_off_amount", "operating_cost", "scrap_material_cost",
			"raw_material_cost", "total_cost"], this.frm.doc.currency);

		this.frm.set_currency_labels(["outstanding_amount", "total_advance"], this.frm.doc.party_account_currency);

		cur_frm.set_df_property("conversion_rate", "description", "1 " + this.frm.doc.currency
			+ " = [?] " + company_currency)

		if(this.frm.doc.price_list_currency && this.frm.doc.price_list_currency!=company_currency) {
			cur_frm.set_df_property("plc_conversion_rate", "description", "1 " + this.frm.doc.price_list_currency
				+ " = [?] " + company_currency)
		}

		// toggle fields
		this.frm.toggle_display(["conversion_rate", "base_total", "base_net_total", "base_total_taxes_and_charges",
			"base_taxes_and_charges_added", "base_taxes_and_charges_deducted",
			"base_grand_total", "base_rounded_total", "base_in_words", "base_discount_amount",
			"base_paid_amount", "base_write_off_amount", "base_operating_cost", 
			"base_raw_material_cost", "base_total_cost", "base_scrap_material_cost"],
			this.frm.doc.currency != company_currency);

		this.frm.toggle_display(["plc_conversion_rate", "price_list_currency"],
			this.frm.doc.price_list_currency != company_currency);

		var show =cint(cur_frm.doc.discount_amount) ||
				((cur_frm.doc.taxes || []).filter(function(d) {return d.included_in_print_rate===1}).length);

		if(frappe.meta.get_docfield(cur_frm.doctype, "net_total"))
			cur_frm.toggle_display("net_total", show);

		if(frappe.meta.get_docfield(cur_frm.doctype, "base_net_total"))
			cur_frm.toggle_display("base_net_total", (show && (me.frm.doc.currency != company_currency)));

	},

	change_grid_labels: function(company_currency) {
		var me = this;

		this.frm.set_currency_labels(["base_rate", "base_net_rate", "base_price_list_rate", "base_amount", "base_net_amount"],
			company_currency, "items");

		this.frm.set_currency_labels(["rate", "net_rate", "price_list_rate", "amount", "net_amount"],
			this.frm.doc.currency, "items");

		if(this.frm.fields_dict["operations"]) {
			this.frm.set_currency_labels(["operating_cost", "hour_rate"], this.frm.doc.currency, "operations");
			this.frm.set_currency_labels(["base_operating_cost", "base_hour_rate"], company_currency, "operations");

			var item_grid = this.frm.fields_dict["operations"].grid;
			$.each(["base_operating_cost", "base_hour_rate"], function(i, fname) {
				if(frappe.meta.get_docfield(item_grid.doctype, fname))
					item_grid.set_column_disp(fname, me.frm.doc.currency != company_currency);
			});
		}

		if(this.frm.fields_dict["scrap_items"]) {
			this.frm.set_currency_labels(["rate", "amount"], this.frm.doc.currency, "scrap_items");
			this.frm.set_currency_labels(["base_rate", "base_amount"], company_currency, "scrap_items");

			var item_grid = this.frm.fields_dict["scrap_items"].grid;
			$.each(["base_rate", "base_amount"], function(i, fname) {
				if(frappe.meta.get_docfield(item_grid.doctype, fname))
					item_grid.set_column_disp(fname, me.frm.doc.currency != company_currency);
			});
		}

		if(this.frm.fields_dict["taxes"]) {
			this.frm.set_currency_labels(["tax_amount", "total", "tax_amount_after_discount"], this.frm.doc.currency, "taxes");

			this.frm.set_currency_labels(["base_tax_amount", "base_total", "base_tax_amount_after_discount"], company_currency, "taxes");
		}

		if(this.frm.fields_dict["advances"]) {
			this.frm.set_currency_labels(["advance_amount", "allocated_amount"],
				this.frm.doc.party_account_currency, "advances");
		}

		// toggle columns
		var item_grid = this.frm.fields_dict["items"].grid;
		$.each(["base_rate", "base_price_list_rate", "base_amount"], function(i, fname) {
			if(frappe.meta.get_docfield(item_grid.doctype, fname))
				item_grid.set_column_disp(fname, me.frm.doc.currency != company_currency);
		});

		var show = (cint(cur_frm.doc.discount_amount)) ||
			((cur_frm.doc.taxes || []).filter(function(d) {return d.included_in_print_rate===1}).length);

		$.each(["net_rate", "net_amount"], function(i, fname) {
			if(frappe.meta.get_docfield(item_grid.doctype, fname))
				item_grid.set_column_disp(fname, show);
		});

		$.each(["base_net_rate", "base_net_amount"], function(i, fname) {
			if(frappe.meta.get_docfield(item_grid.doctype, fname))
				item_grid.set_column_disp(fname, (show && (me.frm.doc.currency != company_currency)));
		});

		// set labels
		var $wrapper = $(this.frm.wrapper);
	},

	recalculate: function() {
		this.calculate_taxes_and_totals();
	},

	recalculate_values: function() {
		this.calculate_taxes_and_totals();
	},

	calculate_charges: function() {
		this.calculate_taxes_and_totals();
	},

	ignore_pricing_rule: function() {
		this.apply_pricing_rule();
	},

	apply_pricing_rule: function(item, calculate_taxes_and_totals) {
		var me = this;
		var args = this._get_args(item);
		if (!(args.items && args.items.length)) {
			if(calculate_taxes_and_totals) me.calculate_taxes_and_totals();
			return;
		}

		return this.frm.call({
			method: "erpnext.accounts.doctype.pricing_rule.pricing_rule.apply_pricing_rule",
			args: {	args: args },
			callback: function(r) {
				if (!r.exc && r.message) {
					me._set_values_for_item_list(r.message);
					if(item) me.set_gross_profit(item);
					if(calculate_taxes_and_totals) me.calculate_taxes_and_totals();
					if(me.frm.doc.apply_discount_on) me.frm.trigger("apply_discount_on")
				}
			}
		});
	},

	_get_args: function(item) {
		var me = this;
		return {
			"items": this._get_item_list(item),
			"customer": me.frm.doc.customer,
			"customer_group": me.frm.doc.customer_group,
			"territory": me.frm.doc.territory,
			"supplier": me.frm.doc.supplier,
			"supplier_type": me.frm.doc.supplier_type,
			"currency": me.frm.doc.currency,
			"conversion_rate": me.frm.doc.conversion_rate,
			"price_list": me.frm.doc.selling_price_list || me.frm.doc.buying_price_list,
			"price_list_currency": me.frm.doc.price_list_currency,
			"plc_conversion_rate": me.frm.doc.plc_conversion_rate,
			"company": me.frm.doc.company,
			"transaction_date": me.frm.doc.transaction_date || me.frm.doc.posting_date,
			"campaign": me.frm.doc.campaign,
			"sales_partner": me.frm.doc.sales_partner,
			"ignore_pricing_rule": me.frm.doc.ignore_pricing_rule,
			"doctype": me.frm.doc.doctype,
			"name": me.frm.doc.name
		};
	},

	_get_item_list: function(item) {
		var item_list = [];
		var append_item = function(d) {
			if (d.item_code) {
				item_list.push({
					"doctype": d.doctype,
					"name": d.name,
					"item_code": d.item_code,
					"item_group": d.item_group,
					"brand": d.brand,
					"qty": d.qty,
					"parenttype": d.parenttype,
					"parent": d.parent,
					"pricing_rule": d.pricing_rule,
					"warehouse": d.warehouse,
					"serial_no": d.serial_no
				});

				// if doctype is Quotation Item / Sales Order Iten then add Margin Type and rate in item_list
				if (in_list(["Quotation Item", "Sales Order Item", "Delivery Note Item", "Sales Invoice Item"]), d.doctype){
					item_list[0]["margin_type"] = d.margin_type
					item_list[0]["margin_rate_or_amount"] = d.margin_rate_or_amount
				}
			}
		};

		if (item) {
			append_item(item);
		} else {
			$.each(this.frm.doc["items"] || [], function(i, d) {
				append_item(d);
			});
		}
		return item_list;
	},

	_set_values_for_item_list: function(children) {
		var me = this;
		var price_list_rate_changed = false;
		for(var i=0, l=children.length; i<l; i++) {
			var d = children[i];
			var existing_pricing_rule = frappe.model.get_value(d.doctype, d.name, "pricing_rule");

			for(var k in d) {
				var v = d[k];
				if (["doctype", "name"].indexOf(k)===-1) {
					if(k=="price_list_rate") {
						if(flt(v) != flt(d.price_list_rate)) price_list_rate_changed = true;
					}
					if(v) {
						frappe.model.set_value(d.doctype, d.name, k, v);
					}
				}
			}

			// if pricing rule set as blank from an existing value, apply price_list
			if(!me.frm.doc.ignore_pricing_rule && existing_pricing_rule && !d.pricing_rule) {
				me.apply_price_list(frappe.get_doc(d.doctype, d.name));
			}
		}

		if(!price_list_rate_changed) me.calculate_taxes_and_totals();
	},

	apply_price_list: function(item) {
		var me = this;
		var args = this._get_args(item);
		if (!((args.items && args.items.length) || args.price_list)) {
			return;
		}

		return this.frm.call({
			method: "erpnext.stock.get_item_details.apply_price_list",
			args: {	args: args },
			callback: function(r) {
				if (!r.exc) {
					me.in_apply_price_list = true;
					me.frm.set_value("price_list_currency", r.message.parent.price_list_currency);
					me.frm.set_value("plc_conversion_rate", r.message.parent.plc_conversion_rate);
					me.in_apply_price_list = false;

					if(args.items.length) {
						me._set_values_for_item_list(r.message.children);
					}
				}
			}
		});
	},

	get_item_wise_taxes_html: function() {
		var item_tax = {};
		var tax_accounts = [];
		var company_currency = this.get_company_currency();

		$.each(this.frm.doc["taxes"] || [], function(i, tax) {
			var tax_amount_precision = precision("tax_amount", tax);
			var tax_rate_precision = precision("rate", tax);
			$.each(JSON.parse(tax.item_wise_tax_detail || '{}'),
				function(item_code, tax_data) {
					if(!item_tax[item_code]) item_tax[item_code] = {};
					if($.isArray(tax_data)) {
						var tax_rate = "";
						if(tax_data[0] != null) {
							tax_rate = (tax.charge_type === "Actual") ?
								format_currency(flt(tax_data[0], tax_amount_precision), company_currency, tax_amount_precision) :
								(flt(tax_data[0], tax_rate_precision) + "%");
						}
						var tax_amount = format_currency(flt(tax_data[1], tax_amount_precision), company_currency,
							tax_amount_precision);

						item_tax[item_code][tax.name] = [tax_rate, tax_amount];
					} else {
						item_tax[item_code][tax.name] = [flt(tax_data, tax_rate_precision) + "%", ""];
					}
				});
			tax_accounts.push([tax.name, tax.account_head]);
		});

		var headings = $.map([__("Item Name")].concat($.map(tax_accounts, function(head) { return head[1]; })),
			function(head) { return '<th style="min-width: 100px;">' + (head || "") + "</th>" }).join("\n");

		var distinct_item_names = [];
		var distinct_items = [];
		$.each(this.frm.doc["items"] || [], function(i, item) {
			if(distinct_item_names.indexOf(item.item_code || item.item_name)===-1) {
				distinct_item_names.push(item.item_code || item.item_name);
				distinct_items.push(item);
			}
		});

		var rows = $.map(distinct_items, function(item) {
			var item_tax_record = item_tax[item.item_code || item.item_name];
			if(!item_tax_record) { return null; }
			return repl("<tr><td>%(item_name)s</td>%(taxes)s</tr>", {
				item_name: item.item_name,
				taxes: $.map(tax_accounts, function(head) {
					return item_tax_record[head[0]] ?
						"<td>(" + item_tax_record[head[0]][0] + ") " + item_tax_record[head[0]][1] + "</td>" :
						"<td></td>";
				}).join("\n")
			});
		}).join("\n");

		if(!rows) return "";
		return '<p><a class="h6 text-muted" href="#" onclick="$(\'.tax-break-up\').toggleClass(\'hide\'); return false;">'
			+ __("Show tax break-up") + '</a><br><br></p>\
		<div class="tax-break-up hide" style="overflow-x: auto;"><table class="table table-bordered table-hover">\
			<thead><tr>' + headings + '</tr></thead> \
			<tbody>' + rows + '</tbody> \
		</table></div>';
	},

	validate_company_and_party: function() {
		var me = this;
		var valid = true;

		$.each(["company", "customer"], function(i, fieldname) {
			if(frappe.meta.has_field(me.frm.doc.doctype, fieldname && me.frm.doc.doctype != "Purchase Order")) {
				if (!me.frm.doc[fieldname]) {
					msgprint(__("Please specify") + ": " +
						frappe.meta.get_label(me.frm.doc.doctype, fieldname, me.frm.doc.name) +
						". " + __("It is needed to fetch Item Details."));
						valid = false;
				}
			}
		});
		return valid;
	},

	get_terms: function() {
		var me = this;
		if(this.frm.doc.tc_name) {
			return frappe.call({
				method: 'erpnext.setup.doctype.terms_and_conditions.terms_and_conditions.get_terms_and_conditions',
				args: {
					template_name: this.frm.doc.tc_name,
					doc: this.frm.doc
				},
				callback: function(r) {
					if(!r.exc) {
						me.frm.set_value("terms", r.message);
					}
				}
			});
		}
	},

	taxes_and_charges: function() {
		var me = this;
		if(this.frm.doc.taxes_and_charges) {
			return this.frm.call({
				method: "erpnext.controllers.accounts_controller.get_taxes_and_charges",
				args: {
					"master_doctype": frappe.meta.get_docfield(this.frm.doc.doctype, "taxes_and_charges",
						this.frm.doc.name).options,
					"master_name": this.frm.doc.taxes_and_charges,
				},
				callback: function(r) {
					if(!r.exc) {
						me.frm.set_value("taxes", r.message);
						me.calculate_taxes_and_totals();
					}
				}
			});
		}
	},

	show_item_wise_taxes: function() {
		if(this.frm.fields_dict.other_charges_calculation) {
			var html = this.get_item_wise_taxes_html();
			if (html) {
				this.frm.toggle_display("other_charges_calculation", true);
				$(this.frm.fields_dict.other_charges_calculation.wrapper).html(html);
			} else {
				this.frm.toggle_display("other_charges_calculation", false);
			}
		}
	},

	is_recurring: function() {
		// set default values for recurring documents
		if(this.frm.doc.is_recurring && this.frm.doc.__islocal) {
			frappe.msgprint(__("Please set recurring after saving"));
			this.frm.set_value('is_recurring', 0);
			return;
		}

		if(this.frm.doc.is_recurring) {
			if(!this.frm.doc.recurring_id) {
				this.frm.set_value('recurring_id', this.frm.doc.name);
			}

			var owner_email = this.frm.doc.owner=="Administrator"
				? frappe.user_info("Administrator").email
				: this.frm.doc.owner;

			this.frm.doc.notification_email_address = $.map([cstr(owner_email),
				cstr(this.frm.doc.contact_email)], function(v) { return v || null; }).join(", ");
			this.frm.doc.repeat_on_day_of_month = frappe.datetime.str_to_obj(this.frm.doc.posting_date).getDate();
		}

		refresh_many(["notification_email_address", "repeat_on_day_of_month"]);
	},

	from_date: function() {
		// set to_date
		if(this.frm.doc.from_date) {
			var recurring_type_map = {'Monthly': 1, 'Quarterly': 3, 'Half-yearly': 6,
				'Yearly': 12};

			var months = recurring_type_map[this.frm.doc.recurring_type];
			if(months) {
				var to_date = frappe.datetime.add_months(this.frm.doc.from_date,
					months);
				this.frm.doc.to_date = frappe.datetime.add_days(to_date, -1);
				refresh_field('to_date');
			}
		}
	},

	set_gross_profit: function(item) {
		if (this.frm.doc.doctype == "Sales Order" && item.valuation_rate) {
			rate = flt(item.rate) * flt(this.frm.doc.conversion_rate || 1);
			item.gross_profit = flt(((rate - item.valuation_rate) * item.qty), precision("amount", item));
		}
	},

	setup_item_selector: function() {
		// TODO: remove item selector

		return;
		if(!this.item_selector) {
			this.item_selector = new erpnext.ItemSelector({frm: this.frm});
		}
	},

	get_advances: function() {
		if(!this.frm.is_return) {
			return this.frm.call({
				method: "set_advances",
				doc: this.frm.doc,
				callback: function(r, rt) {
					refresh_field("advances");
				}
			})
		}
	},

	make_payment_entry: function() {
		return frappe.call({
			method: cur_frm.cscript.get_method_for_payment(),
			args: {
				"dt": cur_frm.doc.doctype,
				"dn": cur_frm.doc.name
			},
			callback: function(r) {
				var doclist = frappe.model.sync(r.message);
				frappe.set_route("Form", doclist[0].doctype, doclist[0].name);
				// cur_frm.refresh_fields()
			}
		});
	},

	get_method_for_payment: function(){
		method = "erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry"
		if(cur_frm.doc.__onload && cur_frm.doc.__onload.make_payment_via_journal_entry){
			if(in_list(['Sales Invoice', 'Purchase Invoice'],  cur_frm.doc.doctype)){
				method = "erpnext.accounts.doctype.journal_entry.journal_entry.get_payment_entry_against_invoice"
			}else {
				method= "erpnext.accounts.doctype.journal_entry.journal_entry.get_payment_entry_against_order"
			}
		}

		return method
	},
});