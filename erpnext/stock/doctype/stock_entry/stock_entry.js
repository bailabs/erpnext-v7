// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors // License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.stock");

erpnext.stock.StockEntry = erpnext.stock.StockController.extend({
	setup: function() {
		var me = this;

		this.frm.fields_dict.bom_no.get_query = function() {
			return {
				filters:{
					"docstatus": 1,
					"is_active": 1
				}
			};
		};

		this.frm.fields_dict.items.grid.get_field('item_code').get_query = function() {
			return erpnext.queries.item({is_stock_item: 1});
		};

		this.frm.set_query("purchase_order", function() {
			return {
				"filters": {
					"docstatus": 1,
					"is_subcontracted": "Yes",
					"company": me.frm.doc.company
				}
			};
		});

		if(cint(frappe.defaults.get_default("auto_accounting_for_stock"))) {
			this.frm.add_fetch("company", "stock_adjustment_account", "expense_account");
			this.frm.fields_dict.items.grid.get_field('expense_account').get_query =
					function() {
				return {
					filters: {
						"company": me.frm.doc.company,
						"is_group": 0
					}
				}
			}
		}
	},

	onload_post_render: function() {
		var me = this;
		this.set_default_account(function() {
			if(me.frm.doc.__islocal && me.frm.doc.company && !me.frm.doc.amended_from) {
				cur_frm.script_manager.trigger("company");
			}
		});

		if(!this.item_selector && false) {
			this.item_selector = new erpnext.ItemSelector({frm: this.frm});
		}
	},

	refresh: function() {
		var me = this;
		erpnext.toggle_naming_series();
		this.toggle_related_fields(this.frm.doc);
		this.toggle_enable_bom();
		this.show_stock_ledger();
		if (cint(frappe.defaults.get_default("auto_accounting_for_stock"))) {
			this.show_general_ledger();
		}
		erpnext.hide_company();
		erpnext.utils.add_item(this.frm);
	},

	on_submit: function() {
		this.clean_up();
	},

	after_cancel: function() {
		this.clean_up();
	},

	set_default_account: function(callback) {
		var me = this;

		if(cint(frappe.defaults.get_default("auto_accounting_for_stock")) && this.frm.doc.company) {
			return this.frm.call({
				method: "erpnext.accounts.utils.get_company_default",
				args: {
					"fieldname": "stock_adjustment_account",
					"company": this.frm.doc.company
				},
				callback: function(r) {
					if (!r.exc) {
						$.each(me.frm.doc.items || [], function(i, d) {
							if(!d.expense_account) d.expense_account = r.message;
						});
						if(callback) callback();
					}
				}
			});
		}
	},

	clean_up: function() {
		// Clear Production Order record from locals, because it is updated via Stock Entry
		if(this.frm.doc.production_order &&
				in_list(["Manufacture", "Material Transfer for Manufacture"], this.frm.doc.purpose)) {
			frappe.model.remove_from_locals("Production Order",
				this.frm.doc.production_order);
		}
	},

	get_items: function() {
		var me = this;
		if(!this.frm.doc.fg_completed_qty || !this.frm.doc.bom_no)
			frappe.throw(__("BOM and Manufacturing Quantity are required"));

		if(this.frm.doc.production_order || this.frm.doc.bom_no) {
			// if production order / bom is mentioned, get items
			return this.frm.call({
				doc: me.frm.doc,
				method: "get_items",
				callback: function(r) {
					if(!r.exc) refresh_field("items");
				}
			});
		}
	},

	qty: function(doc, cdt, cdn) {
		var d = locals[cdt][cdn];
		d.transfer_qty = flt(d.qty) * flt(d.conversion_factor);
		this.calculate_basic_amount(d);
	},

	production_order: function() {
		var me = this;
		this.toggle_enable_bom();

		return frappe.call({
			method: "erpnext.stock.doctype.stock_entry.stock_entry.get_production_order_details",
			args: {production_order: me.frm.doc.production_order},
			callback: function(r) {
				if (!r.exc) {
					$.each(["from_bom", "bom_no", "fg_completed_qty", "use_multi_level_bom"], function(i, field) {
						me.frm.set_value(field, r.message[field]);
					})

					if (me.frm.doc.purpose == "Material Transfer for Manufacture" && !me.frm.doc.to_warehouse)
						me.frm.set_value("to_warehouse", r.message["wip_warehouse"]);


					if (me.frm.doc.purpose == "Manufacture") {
						if(r.message["additional_costs"].length) {
							$.each(r.message["additional_costs"], function(i, row) {
								me.frm.add_child("additional_costs", row);
							})
							refresh_field("additional_costs");
						}

						if (!me.frm.doc.from_warehouse) me.frm.set_value("from_warehouse", r.message["wip_warehouse"]);
						if (!me.frm.doc.to_warehouse) me.frm.set_value("to_warehouse", r.message["fg_warehouse"]);
					}
					me.get_items()
				}
			}
		});
	},

	toggle_enable_bom: function() {
		this.frm.toggle_enable("bom_no", !!!this.frm.doc.production_order);
	},

	add_excise_button: function() {
		if(frappe.boot.sysdefaults.country === "India")
			this.frm.add_custom_button(__("Excise Invoice"), function() {
				var excise = frappe.model.make_new_doc_and_get_name('Journal Entry');
				excise = locals['Journal Entry'][excise];
				excise.voucher_type = 'Excise Entry';
				frappe.set_route('Form', 'Journal Entry', excise.name);
			}, __("Make"));
	},

	items_add: function(doc, cdt, cdn) {
		var row = frappe.get_doc(cdt, cdn);
		this.frm.script_manager.copy_from_first_row("items", row, ["expense_account", "cost_center"]);

		if(!row.s_warehouse) row.s_warehouse = this.frm.doc.from_warehouse;
		if(!row.t_warehouse) row.t_warehouse = this.frm.doc.to_warehouse;
	},

	source_mandatory: ["Material Issue", "Material Transfer", "Subcontract", "Material Transfer for Manufacture"],
	target_mandatory: ["Material Receipt", "Material Transfer", "Subcontract", "Material Transfer for Manufacture"],

	from_warehouse: function(doc) {
		var me = this;
		this.set_warehouse_if_different("s_warehouse", doc.from_warehouse, function(row) {
			return me.source_mandatory.indexOf(me.frm.doc.purpose)!==-1;
		});
	},

	to_warehouse: function(doc) {
		var me = this;
		this.set_warehouse_if_different("t_warehouse", doc.to_warehouse, function(row) {
			return me.target_mandatory.indexOf(me.frm.doc.purpose)!==-1;
		});
	},

	set_warehouse_if_different: function(fieldname, value, condition) {
		var changed = false;
		for (var i=0, l=(this.frm.doc.items || []).length; i<l; i++) {
			var row = this.frm.doc.items[i];
			if (row[fieldname] != value) {
				if (condition && !condition(row)) {
					continue;
				}

				frappe.model.set_value(row.doctype, row.name, fieldname, value, "Link");
				changed = true;
			}
		}
		refresh_field("items");
	},

	items_on_form_rendered: function(doc, grid_row) {
		erpnext.setup_serial_no();
	},

	basic_rate: function(doc, cdt, cdn) {
		var item = frappe.model.get_doc(cdt, cdn);
		this.calculate_basic_amount(item);
	},

	s_warehouse: function(doc, cdt, cdn) {
		this.get_warehouse_details(doc, cdt, cdn)
	},

	t_warehouse: function(doc, cdt, cdn) {
		this.get_warehouse_details(doc, cdt, cdn)
	},

	get_warehouse_details: function(doc, cdt, cdn) {
		var me = this;
		var d = locals[cdt][cdn];
		if(!d.bom_no) {
			frappe.call({
				method: "erpnext.stock.doctype.stock_entry.stock_entry.get_warehouse_details",
				args: {
					"args": {
						'item_code': d.item_code,
						'warehouse': cstr(d.s_warehouse) || cstr(d.t_warehouse),
						'transfer_qty': d.transfer_qty,
						'serial_no': d.serial_no,
						'qty': d.s_warehouse ? -1* d.qty : d.qty,
						'posting_date': this.frm.doc.posting_date,
						'posting_time': this.frm.doc.posting_time
					}
				},
				callback: function(r) {
					if (!r.exc) {
						$.extend(d, r.message);
						me.calculate_basic_amount(d);
					}
				}
			});
		}
	},

	calculate_basic_amount: function(item) {
		item.basic_amount = flt(flt(item.transfer_qty) * flt(item.basic_rate),
			precision("basic_amount", item));

		this.calculate_amount();
	},

	calculate_amount: function() {
		this.calculate_total_additional_costs();

		var total_basic_amount = frappe.utils.sum(
			(this.frm.doc.items || []).map(function(i) { return i.t_warehouse ? flt(i.basic_amount) : 0; })
		);

		for (var i in this.frm.doc.items) {
			var item = this.frm.doc.items[i];

			if (item.t_warehouse && total_basic_amount) {
				item.additional_cost = (flt(item.basic_amount) / total_basic_amount) * this.frm.doc.total_additional_costs;
			} else {
				item.additional_cost = 0;
			}

			item.amount = flt(item.basic_amount + flt(item.additional_cost),
				precision("amount", item));

			item.valuation_rate = flt(flt(item.basic_rate)
				+ (flt(item.additional_cost) / flt(item.transfer_qty)),
				precision("valuation_rate", item));
		}

		refresh_field('items');
	},

	calculate_total_additional_costs: function() {
		var total_additional_costs = frappe.utils.sum(
			(this.frm.doc.additional_costs || []).map(function(c) { return flt(c.amount); })
		);

		this.frm.set_value("total_additional_costs", flt(total_additional_costs, precision("total_additional_costs")));
	},
});

cur_frm.script_manager.make(erpnext.stock.StockEntry);

cur_frm.cscript.toggle_related_fields = function(doc) {
	cur_frm.toggle_enable("from_warehouse", doc.purpose!='Material Receipt');
	cur_frm.toggle_enable("to_warehouse", doc.purpose!='Material Issue');

	cur_frm.fields_dict["items"].grid.set_column_disp("s_warehouse", doc.purpose!='Material Receipt');
	cur_frm.fields_dict["items"].grid.set_column_disp("t_warehouse", doc.purpose!='Material Issue');

	cur_frm.cscript.toggle_enable_bom();

	if (doc.purpose == 'Subcontract') {
		doc.customer = doc.customer_name = doc.customer_address =
			doc.delivery_note_no = doc.sales_invoice_no = null;
	} else {
		doc.customer = doc.customer_name = doc.customer_address =
			doc.delivery_note_no = doc.sales_invoice_no = doc.supplier =
			doc.supplier_name = doc.supplier_address = doc.purchase_receipt_no = null;
	}
	if(doc.purpose == "Material Receipt") {
		cur_frm.set_value("from_bom", 0);
	}

	// Addition costs based on purpose
	cur_frm.toggle_display(["additional_costs", "total_additional_costs", "additional_costs_section"],
		doc.purpose!='Material Issue');

	cur_frm.fields_dict["items"].grid.set_column_disp("additional_cost", doc.purpose!='Material Issue');
}

cur_frm.fields_dict['production_order'].get_query = function(doc) {
	return {
		filters: [
			['Production Order', 'docstatus', '=', 1],
			['Production Order', 'qty', '>','`tabProduction Order`.produced_qty'],
			['Production Order', 'company', '=', cur_frm.doc.company]
		]
	}
}

cur_frm.cscript.purpose = function(doc, cdt, cdn) {
	cur_frm.fields_dict.items.grid.refresh();
	cur_frm.cscript.toggle_related_fields(doc);
}

// Overloaded query for link batch_no
cur_frm.fields_dict['items'].grid.get_field('batch_no').get_query = function(doc, cdt, cdn) {
	var item = locals[cdt][cdn];
	if(!item.item_code) {
		frappe.throw(__("Please enter Item Code to get batch no"));
	}
	else {
		if (in_list(["Material Transfer for Manufacture", "Manufacture", "Repack", "Subcontract"], doc.purpose)) {
			var filters = {
				'item_code': item.item_code,
				'posting_date': me.frm.doc.posting_date || nowdate()
			}
		} else {
			var filters = {
				'item_code': item.item_code
			}
		}


		if(item.s_warehouse) filters["warehouse"] = item.s_warehouse
		return {
			query : "erpnext.controllers.queries.get_batch_no",
			filters: filters
		}
	}
}

cur_frm.cscript.validate = function(doc, cdt, cdn) {
	cur_frm.cscript.validate_items(doc);
}

cur_frm.cscript.validate_items = function(doc) {
	cl = doc.items || [];
	if (!cl.length) {
		msgprint(__("Item table can not be blank"));
		validated = false;
	}
}

cur_frm.cscript.expense_account = function(doc, cdt, cdn) {
	erpnext.utils.copy_value_in_all_row(doc, cdt, cdn, "items", "expense_account");
}

cur_frm.cscript.cost_center = function(doc, cdt, cdn) {
	erpnext.utils.copy_value_in_all_row(doc, cdt, cdn, "items", "cost_center");
}


frappe.ui.form.on('Landed Cost Taxes and Charges', {
	amount: function(frm) {
		frm.cscript.calculate_amount();
	}
})

frappe.ui.form.on('Stock Entry Detail', {
	qty: function(frm, cdt, cdn) {
		frm.events.set_serial_no(frm, cdt, cdn);
	},

	s_warehouse: function(frm, cdt, cdn) {
		frm.events.set_serial_no(frm, cdt, cdn);
	},
	barcode: function(doc, cdt, cdn) {
		var d = locals[cdt][cdn];
		if (d.barcode) {
			frappe.call({
				method: "erpnext.stock.get_item_details.get_item_code",
				args: {"barcode": d.barcode },
				callback: function(r) {
					if (!r.exe){
						frappe.model.set_value(cdt, cdn, "item_code", r.message);
					}
				}
			});
		}
	},
	uom: function(doc, cdt, cdn) {
		var d = locals[cdt][cdn];
		if(d.uom && d.item_code){
			arg = {
					'item_code':d.item_code,
					'uom':d.uom,
					'qty':d.qty
			};
			return frappe.call({
				doc: cur_frm.doc,
				method: "get_uom_details",
				args: arg,
				callback: function(r) {
					if(r.message) {
						var d = locals[cdt][cdn];
						$.each(r.message, function(k, v) {
							d[k] = v;
						});
						refresh_field("items");
					}
				}
			});
		}
	},
	item_code: function(doc, cdt, cdn) {
		var d = locals[cdt][cdn];
		if(d.item_code) {
			args = {
				'item_code'			: d.item_code,
				'warehouse'			: cstr(d.s_warehouse) || cstr(d.t_warehouse),
				'transfer_qty'		: d.transfer_qty,
				'serial_no	'		: d.serial_no,
				'bom_no'			: d.bom_no,
				'expense_account'	: d.expense_account,
				'cost_center'		: d.cost_center,
				'company'			: cur_frm.doc.company,
				'qty'				: d.qty
			};
			return frappe.call({
				doc: cur_frm.doc,
				method: "get_item_details",
				args: args,
				callback: function(r) {
					if(r.message) {
						var d = locals[cdt][cdn];
						$.each(r.message, function(k, v) {
							d[k] = v;
						});
						refresh_field("items");
					}
				}
			});
		}
	}
})

frappe.ui.form.on('Stock Entry', {
	company: function(doc, cdt, cdn) {
		if(doc.company) {
			var company_doc = frappe.get_doc(":Company", doc.company);
			if(company_doc.default_letter_head) {
				cur_frm.set_value("letter_head", company_doc.default_letter_head);
			}
		}
	},
	set_serial_no: function(doc, cdt, cdn) {
		var d = frappe.model.get_doc(cdt, cdn);
		if(!d.item_code && !d.s_warehouse && !d.qty) return;
		var	args = {
				'item_code'	: d.item_code,
				'warehouse'	: cstr(d.s_warehouse),
				'qty'		: d.qty
			};
			frappe.call({
				method: "erpnext.stock.get_item_details.get_serial_no",
				args: {"args": args},
				callback: function(r) {
					if (!r.exe){
						frappe.model.set_value(cdt, cdn, "serial_no", r.message);
					}
				}
			});
		},
})
