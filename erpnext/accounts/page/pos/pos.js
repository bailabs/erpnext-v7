frappe.provide("erpnext.pos");
{% include "erpnext/public/js/controllers/taxes_and_totals.js" %}

frappe.pages['pos'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Point of Sale'),
		single_column: true
	});

	wrapper.pos = new erpnext.pos.PointOfSale(wrapper)
}

frappe.pages['pos'].refresh = function(wrapper) {
	window.onbeforeunload = function () {
		return wrapper.pos.beforeunload()
	}
}


erpnext.pos.PointOfSale = erpnext.taxes_and_totals.extend({
	init: function(wrapper){
		this.page = wrapper.page;
		this.wrapper = $(wrapper).find('.page-content');
		this.set_indicator();
		this.onload();
		this.make_menu_list();
		this.si_docs = this.get_doc_from_localstorage();
	},

	beforeunload: function(e){
		if(this.connection_status == false && frappe.get_route()[0] == "pos"){
			e = e || window.event;

			// For IE and Firefox prior to version 4
			if (e) {
			    e.returnValue = __("You are in offline mode. You will not be able to reload until you have network.");
				return
			}

			// For Safari
			return __("You are in offline mode. You will not be able to reload until you have network.");
		}
	},

	check_internet_connection: function(){
		var me = this;
		//Check Internet connection after every 30 seconds
		setInterval(function(){
			me.set_indicator();
		}, 5000)
	},

	set_indicator: function(){
		var me = this;
		// navigator.onLine
		this.connection_status = false;
		this.page.set_indicator(__("Offline"), "grey")
		frappe.call({
			method:"frappe.handler.ping",
			callback: function(r){
				if(r.message){
					me.connection_status = true;
					me.page.set_indicator(__("Online"), "green")
				}
			}
		})
	},

	onload: function(){
		var me = this;
		this.get_data_from_server(function(){
			me.create_new();
		});
	},

	make_menu_list: function(){
		var me = this;

		this.page.add_menu_item(__("New Sales Invoice"), function() {
			me.save_previous_entry();
			me.create_new();
		})

		this.page.add_menu_item(__("View Offline Records"), function(){
			me.show_unsync_invoice_list();
		});

		this.page.add_menu_item(__("Sync Master Data"), function(){
			me.get_data_from_server(function(){
				me.load_data(false);
				me.make_customer();
				me.make_item_list();
				me.set_missing_values();
			})
		});

		this.page.add_menu_item(__("Sync Offline Invoices"), function(){
			me.sync_sales_invoice()
		});

		this.page.add_menu_item(__("POS Profile"), function() {
			frappe.set_route('List', 'POS Profile');
		});
	},

	show_unsync_invoice_list: function(){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();
		this.list_dialog = new frappe.ui.Dialog({
			title: 'Invoice List'
		});

		this.list_dialog.show();
		this.list_body = this.list_dialog.body;
		if(me.pos_profile_data["allow_delete"]) {
			this.list_dialog.set_primary_action(__("Delete"), function() {
				frappe.confirm(__("Delete permanently?"), function () {
					me.delete_records();
				})
			}).addClass("btn-danger");
			this.toggle_primary_action();
		}

		if(this.si_docs.length > 0){
			me.render_offline_data();
			me.dialog_actions()
		}else{
			$(this.list_body).append(repl('<div class="media-heading">%(message)s</div>', {'message': __("All records are synced.")}))
		}
	},

	render_offline_data: function() {
		var me = this;

		this.removed_items = [];
		$(this.list_body).empty();

		$(this.list_body).append('<div class="row list-row list-row-head pos-invoice-list">\
				<div class="col-xs-1"><input class="list-select-all" type="checkbox"></div>\
				<div class="col-xs-3">Customer</div>\
				<div class="col-xs-2 text-left">Status</div>\
				<div class="col-xs-3 text-right">Paid Amount</div>\
				<div class="col-xs-3 text-right">Grand Total</div>\
		</div>')

		$.each(this.si_docs, function(index, data){
			for(key in data) {
				$(frappe.render_template("pos_invoice_list", {
					sr: index + 1,
					name: key,
					customer: data[key].customer,
					paid_amount: format_currency(data[key].paid_amount, me.frm.doc.currency),
					grand_total: format_currency(data[key].grand_total, me.frm.doc.currency),
					data: me.get_doctype_status(data[key])
				})).appendTo($(me.list_body));
			}
		})
	},

	dialog_actions: function() {
		var me = this;

		$(this.list_body).find('.list-column').click(function() {
			me.name = $(this).parents().attr('invoice-name')
			me.edit_record();
		})

		$(this.list_body).find('.list-select-all').click(function() {
			me.removed_items = [];
			$(me.list_body).find('.list-delete').prop("checked", $(this).is(":checked"))
			if($(this).is(":checked")) {
				$.each(me.si_docs, function(index, data){
					for(key in data) {
						me.removed_items.push(key)
					}
				})
			}

			me.toggle_primary_action();
		})

		$(this.list_body).find('.list-delete').click(function() {
			me.name = $(this).parent().parent().attr('invoice-name');
			if($(this).is(":checked")) {
				me.removed_items.push(me.name);
			} else {
				me.removed_items.pop(me.name)
			}

			me.toggle_primary_action();
		})
	},

	edit_record: function() {
		var me = this;

		doc_data = this.get_invoice_doc(this.si_docs);
		if(doc_data){
			this.frm.doc = doc_data[0][this.name];
			this.set_missing_values();
			this.refresh(false);
			this.disable_input_field();
			this.list_dialog.hide();
		}
	},

	delete_records: function() {
		var me = this;
		this.remove_doc_from_localstorage()
		this.update_localstorage();
		this.render_offline_data();
		this.dialog_actions();
		this.toggle_primary_action();
	},

	toggle_primary_action: function() {
		var me = this;
		if(this.removed_items && this.removed_items.length > 0) {
			$(this.list_dialog.wrapper).find('.btn-danger').show();
		} else {
			$(this.list_dialog.wrapper).find('.btn-danger').hide();
		}
	},

	get_doctype_status: function(doc){
		if(doc.docstatus == 0) {
			return {status: "Draft", indicator: "red"}
		}else if(doc.outstanding_amount == 0) {
			return {status: "Paid", indicator: "green"}
		}else {
			return {status: "Submitted", indicator: "blue"}
		}
	},

	set_missing_values: function(){
		var me = this;
		doc = JSON.parse(localStorage.getItem('doc'))
		if(this.frm.doc.payments.length == 0){
			this.frm.doc.payments = doc.payments;
			this.calculate_outstanding_amount();
		}

		if(this.frm.doc.customer){
			this.party_field.$input.val(this.frm.doc.customer);
		}

		if(!this.frm.doc.write_off_account){
			this.frm.doc.write_off_account = doc.write_off_account
		}

		if(!this.frm.doc.account_for_change_amount){
			this.frm.doc.account_for_change_amount = doc.account_for_change_amount
		}
	},

	get_invoice_doc: function(si_docs){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();

		return $.grep(this.si_docs, function(data){
			for(key in data){
				return key == me.name
			}
		})
	},

	get_data_from_server: function(callback){
		var me = this;
		frappe.call({
			method: "erpnext.accounts.doctype.sales_invoice.pos.get_pos_data",
			freeze: true,
			freeze_message: __("Master data syncing, it might take some time"),
			callback: function(r){
				me.init_master_data(r)
				localStorage.setItem('doc', JSON.stringify(r.message.doc));
				me.set_interval_for_si_sync();
				me.check_internet_connection();
				if(callback){
					callback();
				}
			}
		})
	},

	init_master_data: function(r){
		var me = this;
		this.meta = r.message.meta;
		this.item_data = r.message.items;
		this.customers = r.message.customers;
		this.serial_no_data = r.message.serial_no_data;
		this.batch_no_data = r.message.batch_no_data;
		this.tax_data = r.message.tax_data;
		this.price_list_data = r.message.price_list_data;
		this.bin_data = r.message.bin_data;
		this.pricing_rules = r.message.pricing_rules;
		this.print_template = r.message.print_template;
		this.pos_profile_data = r.message.pos_profile;
		this.default_customer = r.message.default_customer || null;
	},

	save_previous_entry : function(){
		if(this.frm.doc.docstatus < 1 && this.frm.doc.items.length > 0){
			this.create_invoice()
		}
	},

	create_new: function(){
		var me = this;
		this.frm = {}
		this.name = '';
		this.load_data(true);
		this.setup();
	},

	load_data: function(load_doc){
		var me = this;

		this.items = this.item_data;
		this.actual_qty_dict = {};

		if(load_doc) {
			this.frm.doc =  JSON.parse(localStorage.getItem('doc'));
		}

		$.each(this.meta, function(i, data){
			frappe.meta.sync(data)
			locals["DocType"][data.name] = data;
		})

		this.print_template_data = frappe.render_template("print_template",
			{content: this.print_template, title:"POS",
			base_url: frappe.urllib.get_base_url(), print_css: frappe.boot.print_css})
	},

	setup: function(){
		this.wrapper.html(frappe.render_template("pos", this.frm.doc));
		this.set_transaction_defaults("Customer");
		this.make();
		this.set_primary_action();
	},

	set_transaction_defaults: function(party) {
		var me = this;
		this.party = party;
		this.price_list = (party == "Customer" ?
			this.frm.doc.selling_price_list : this.frm.doc.buying_price_list);
		this.price_list_field = (party == "Customer" ? "selling_price_list" : "buying_price_list");
		this.sales_or_purchase = (party == "Customer" ? "Sales" : "Purchase");
	},

	make: function() {
		this.make_search();
		this.make_customer();
		this.make_item_list();
		this.make_discount_field()
	},

	make_search: function() {
		var me = this;
		this.search = frappe.ui.form.make_control({
			df: {
				"fieldtype": "Data",
				"label": "Item",
				"fieldname": "pos_item",
				"placeholder": __("Search Item")
			},
			parent: this.wrapper.find(".search-area"),
			only_input: true,
		});

		this.search.make_input();
		this.search.$input.on("keyup", function() {
			setTimeout(function() {
				me.items = me.get_items();
				me.make_item_list();
			}, 1000);
		});

		this.party_field = frappe.ui.form.make_control({
			df: {
				"fieldtype": "Data",
				"options": this.party,
				"label": this.party,
				"fieldname": this.party.toLowerCase(),
				"placeholder": __("Select or add new customer")
			},
			parent: this.wrapper.find(".party-area"),
			only_input: true,
		});

		this.party_field.make_input();
		this.set_focus()
	},

	set_focus: function(){
		if(this.default_customer){
			this.search.$input.focus();
		}else{
			this.party_field.$input.focus();
		}
	},

	make_customer: function() {
		var me = this;

		if(this.default_customer && !this.frm.doc.customer){
			this.party_field.$input.val(this.default_customer);
			this.frm.doc.customer = this.default_customer;
		}

		this.party_field.$input.autocomplete({
			autoFocus: true,
			source: function (request, response) {
				me.customer_data = me.get_customers(request.term)
				me.add_customer();

				response($.map(me.customer_data, function(data){
					return {label: data.name, customer_name: data.name, customer_group: data.customer_group,
						territory: data.territory, onclick: data.onclick}
				}))
			},
			select: function(event, ui){
				if(ui.item.onclick) {
					ui.item.value = ""
					ui.item.onclick(me);
				}else if(ui.item) {
					me.update_customer_data(ui.item)
				}
				me.refresh();
			},
			change: function(event, ui) {
				if(!ui.item) {
					me.frm.doc.customer = $(this).val();
				}
			}
		}).on("focus", function(){
			setTimeout(function() {
				if(!me.party_field.$input.val()) {
					me.party_field.$input.autocomplete( "search", " " );
				}
			}, 500);
		}).autocomplete(this.party_field).data('ui-autocomplete')._renderItem = function(ul, d){
			var html = "<span>" + __(d.label) + "</span>";
			return $('<li></li>')
				.data('item.autocomplete', d)
				.html('<a><p>' + html + '</p></a>')
				.appendTo(ul);
		}
	},

	add_customer: function() {
		var me = this;
		if(this.connection_status) {
			this.customer_data.push({
				name: "<span class='text-primary link-option'>"
					+ "<i class='fa fa-plus' style='margin-right: 5px;'></i> "
					+ __("Create a new Customer")
					+ "</span>",
				onclick: me.new_customer
			});
		}
	},

	new_customer: function(obj) {
		var me = obj;
		frappe.ui.form.quick_entry('Customer', function(doc){
			me.customers.push(doc)
			me.party_field.$input.val(doc.name);
			me.update_customer_data(doc)
		})
	},

	update_customer_data: function(doc) {
		var me = this;
		this.frm.doc.customer = doc.label || doc.name;
		this.frm.doc.customer_name = doc.customer_name;
		this.frm.doc.customer_group = doc.customer_group;
		this.frm.doc.territory = doc.territory;
	},

	get_customers: function(key){
		var me = this;
		key = key.toLowerCase().trim()
		var re = new RegExp('%', 'g');
		var reg = new RegExp(key.replace(re, '\\w*\\s*[a-zA-Z0-9]*'))

		if(key){
			return $.grep(this.customers, function(data) {
				if(reg.test(data.name.toLowerCase())
					|| reg.test(data.customer_name.toLowerCase())
					|| (data.customer_group && reg.test(data.customer_group.toLowerCase()))){
					return data
				}
			})
		}else{
			customers = this.customers.sort(function(a,b){ return a.idx < b.idx })
			return customers.slice(0, 20)
		}
	},

	make_item_list: function() {
		var me = this;
		if(!this.price_list) {
			msgprint(__("Price List not found or disabled"));
			return;
		}

		me.item_timeout = null;

		var $wrap = me.wrapper.find(".item-list");
		me.wrapper.find(".item-list").empty();

		if (this.items.length > 0) {
			$.each(this.items, function(index, obj) {
				if(index < 30){
					$(frappe.render_template("pos_item", {
						item_code: obj.name,
						item_price: format_currency(me.price_list_data[obj.name], me.frm.doc.currency),
						item_name: obj.name===obj.item_name ? "" : obj.item_name,
						item_image: obj.image ? "url('" + obj.image + "')" : null,
						color: frappe.get_palette(obj.item_name),
						abbr: frappe.get_abbr(obj.item_name)
					})).tooltip().appendTo($wrap);
				}
			});
		} else {
			$("<h4>Searching record not found.</h4>").appendTo($wrap)
		}

		if(this.items.length == 1
			&& this.search.$input.val()) {
			this.search.$input.val("");
			this.add_to_cart();
		}

		// if form is local then allow this function
		$(me.wrapper).find("div.pos-item").on("click", function() {
			me.customer_validate();
			if(me.frm.doc.docstatus==0) {
				me.items = me.get_items($(this).attr("data-item-code"))
				me.add_to_cart();
			}
		});
	},

	get_items: function(item_code){
		// To search item as per the key enter

		var me = this;
		this.item_serial_no = {};
		this.item_batch_no = {};

		if(item_code){
			return $.grep(this.item_data, function(item){
				if(item.item_code == item_code ){
					return true
				}
			})
		}

		key =  this.search.$input.val().toLowerCase().replace(/[&\/\\#,+()\[\]$~.'":*?<>{}]/g,'\\$&');
		var re = new RegExp('%', 'g');
		var reg = new RegExp(key.replace(re, '[\\w*\\s*[a-zA-Z0-9]*]*'))
		search_status = true

		if(key){
			return $.grep(this.item_data, function(item){
				if(search_status){
					if(in_list(me.batch_no_data[item.item_code], me.search.$input.val())){
						search_status = false;
						return me.item_batch_no[item.item_code] = me.search.$input.val()
					} else if( me.serial_no_data[item.item_code]
						&& in_list(Object.keys(me.serial_no_data[item.item_code]), me.search.$input.val())) {
						search_status = false;
						me.item_serial_no[item.item_code] = [me.search.$input.val(), me.serial_no_data[item.item_code][me.search.$input.val()]]
						return true
					} else if(item.barcode == me.search.$input.val()) {
						search_status = false;
						return item.barcode == me.search.$input.val();
					} else if(reg.test(item.item_code.toLowerCase()) || reg.test(item.description.toLowerCase()) ||
					reg.test(item.item_name.toLowerCase()) || reg.test(item.item_group.toLowerCase()) ){
						return true
					}
				}
			})
		}else{
			return this.item_data;
		}
	},

	bind_qty_event: function() {
		var me = this;

		$(this.wrapper).find(".pos-item-qty").on("change", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			var qty = $(this).val();
			me.update_qty(item_code, qty)
		})

		$(this.wrapper).find("[data-action='increase-qty']").on("click", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			var qty = flt($(this).parents(".pos-bill-item").find('.pos-item-qty').val()) + 1;
			me.update_qty(item_code, qty)
		})

		$(this.wrapper).find("[data-action='decrease-qty']").on("click", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			var qty = flt($(this).parents(".pos-bill-item").find('.pos-item-qty').val()) - 1;
			me.update_qty(item_code, qty)
		})
	},
	
	update_qty: function(item_code, qty) {
		var me = this;
		this.items = this.get_items(item_code);
		this.validate_serial_no()
		this.update_qty_rate_against_item_code(item_code, "qty", qty);
	},

	update_rate: function() {
		var me = this;

		$(this.wrapper).find(".pos-item-rate").on("change", function(){
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			me.update_qty_rate_against_item_code(item_code, "rate", $(this).val());
		})
	},

	update_qty_rate_against_item_code: function(item_code, field, value){
		var me = this;
		if(value < 0){
			frappe.throw(__("Enter value must be positive"));
		}

		this.remove_item = []
		$.each(this.frm.doc["items"] || [], function(i, d) {
			if(d.serial_no && field == 'qty'){
				me.validate_serial_no_qty(d, item_code, field, value)
			}

			if (d.item_code == item_code) {
				d[field] = flt(value);
				d.amount = flt(d.rate) * flt(d.qty);
				if(d.qty==0){
					me.remove_item.push(d.idx)
				}
			}
		});

		if(field == 'qty'){
			this.remove_zero_qty_item();
		}

		this.update_paid_amount_status(false)
	},

	remove_zero_qty_item: function(){
		var me = this;
		idx = 0
		this.items = []
		idx = 0
		$.each(this.frm.doc["items"] || [], function(i, d) {
			if(!in_list(me.remove_item, d.idx)){
				d.idx = idx;
				me.items.push(d);
				idx++;
			}
		});

		this.frm.doc["items"] = this.items;
	},

	make_discount_field: function(){
		var me = this;

		this.wrapper.find('input.discount-percentage').on("change", function() {
			me.frm.doc.additional_discount_percentage = flt($(this).val(), precision("additional_discount_percentage"));
			total = me.frm.doc.grand_total

			if(me.frm.doc.apply_discount_on == 'Net Total'){
				total = me.frm.doc.net_total
			}

			me.frm.doc.discount_amount = flt(total*flt(me.frm.doc.additional_discount_percentage) / 100, precision("discount_amount"));
			me.wrapper.find('input.discount-amount').val(me.frm.doc.discount_amount)
			me.refresh();
		});

		this.wrapper.find('input.discount-amount').on("change", function() {
			me.frm.doc.discount_amount = flt($(this).val(), precision("discount_amount"));
			me.frm.doc.additional_discount_percentage = 0.0;
			me.wrapper.find('input.discount-percentage').val(0);
			me.refresh();
		});
	},

	customer_validate: function(){
		var me = this;
		if(!this.frm.doc.customer){
			frappe.throw(__("Please select customer"))
		}
	},

	add_to_cart: function() {
		var me = this;
		var caught = false;
		var no_of_items = me.wrapper.find(".pos-bill-item").length;

		this.customer_validate();
		this.mandatory_batch_no();
		this.validate_serial_no();
		this.validate_warehouse();

		if (no_of_items != 0) {
			$.each(this.frm.doc["items"] || [], function(i, d) {
				if (d.item_code == me.items[0].item_code) {
					caught = true;
					d.qty += 1;
					d.amount = flt(d.rate) * flt(d.qty);
					if(me.item_serial_no[d.item_code]){
						d.serial_no += '\n' + me.item_serial_no[d.item_code][0]
						d.warehouse = me.item_serial_no[d.item_code][1]
					}

					if(me.item_batch_no.length){
						d.batch_no = me.item_batch_no[d.item_code]
					}
				}
			});
		}

		// if item not found then add new item
		if (!caught)
			this.add_new_item_to_grid();

		this.update_paid_amount_status(false)
	},

	add_new_item_to_grid: function() {
		var me = this;
		this.child = frappe.model.add_child(this.frm.doc, this.frm.doc.doctype + " Item", "items");
		this.child.item_code = this.items[0].item_code;
		this.child.item_name = this.items[0].item_name;
		this.child.stock_uom = this.items[0].stock_uom;
		this.child.description = this.items[0].description;
		this.child.qty = 1;
		this.child.item_group = this.items[0].item_group;
		this.child.cost_center = this.pos_profile_data['cost_center'] || this.items[0].cost_center;
		this.child.income_account = this.pos_profile_data['income_account'] || this.items[0].income_account;
		this.child.warehouse = (this.item_serial_no[this.child.item_code]
			? this.item_serial_no[this.child.item_code][1] : (this.pos_profile_data['warehouse'] || this.items[0].default_warehouse) );
		this.child.price_list_rate = flt(this.price_list_data[this.child.item_code], 9) / flt(this.frm.doc.conversion_rate, 9);
		this.child.rate = flt(this.price_list_data[this.child.item_code], 9) / flt(this.frm.doc.conversion_rate, 9);
		this.child.actual_qty = me.get_actual_qty(this.items[0]);
		this.child.amount = flt(this.child.qty) * flt(this.child.rate);
		this.child.batch_no = this.item_batch_no[this.child.item_code];
		this.child.serial_no = (this.item_serial_no[this.child.item_code]
			? this.item_serial_no[this.child.item_code][0] : '');
		this.child.item_tax_rate = JSON.stringify(this.tax_data[this.child.item_code]);
	},

	update_paid_amount_status: function(update_paid_amount){
		if(this.name){
			update_paid_amount = update_paid_amount ? false : true;
		}

		this.refresh(update_paid_amount);
	},

	refresh: function(update_paid_amount) {
		var me = this;
		this.refresh_fields(update_paid_amount);
		this.bind_qty_event();
		this.update_rate();
		this.set_primary_action();
	},

	refresh_fields: function(update_paid_amount) {
		this.apply_pricing_rule();
		this.discount_amount_applied = false;
		this._calculate_taxes_and_totals();
		this.calculate_discount_amount();
		this.show_items_in_item_cart();
		this.set_taxes();
		this.calculate_outstanding_amount(update_paid_amount);
		this.set_totals();
	},

	get_company_currency: function() {
		return erpnext.get_currency(this.frm.doc.company);
	},

	show_item_wise_taxes: function(){
		return null;
	},

	show_items_in_item_cart: function() {
		var me = this;
		var $items = this.wrapper.find(".items").empty();
		$.each(this.frm.doc.items|| [], function(i, d) {
			$(frappe.render_template("pos_bill_item", {
				item_code: d.item_code,
				item_name: (d.item_name===d.item_code || !d.item_name) ? "" : ("<br>" + d.item_name),
				qty: d.qty,
				actual_qty: me.actual_qty_dict[d.item_code] || 0,
				projected_qty: d.projected_qty,
				rate: format_number(d.rate, me.frm.doc.currency),
				enabled: me.pos_profile_data["allow_user_to_edit_rate"] ? true: false,
				amount: format_currency(d.amount, me.frm.doc.currency)
			})).appendTo($items);
		});

		this.wrapper.find("input.pos-item-qty").on("focus", function() {
			$(this).select();
		});

		this.wrapper.find("input.pos-item-rate").on("focus", function() {
			$(this).select();
		});
	},

	set_taxes: function(){
		var me = this;
		me.frm.doc.total_taxes_and_charges = 0.0

		var taxes = this.frm.doc.taxes || [];
		$(this.wrapper)
			.find(".tax-area").toggleClass("hide", (taxes && taxes.length) ? false : true)
			.find(".tax-table").empty();

		$.each(taxes, function(i, d) {
			if (d.tax_amount && cint(d.included_in_print_rate) == 0) {
				$(frappe.render_template("pos_tax_row", {
					description: d.description,
					tax_amount: format_currency(flt(d.tax_amount_after_discount_amount),
						me.frm.doc.currency)
				})).appendTo(me.wrapper.find(".tax-table"));
			}
		});
	},

	set_totals: function() {
		var me = this;
		this.wrapper.find(".net-total").text(format_currency(me.frm.doc.total, me.frm.doc.currency));
		this.wrapper.find(".grand-total").text(format_currency(me.frm.doc.grand_total, me.frm.doc.currency));
	},

	set_primary_action: function() {
		var me = this;

		if (this.frm.doc.docstatus==0) {
			this.page.set_primary_action(__("Pay"), function() {
				me.validate();
				me.update_paid_amount_status(true);
				me.create_invoice();
				me.make_payment();
			}, "octicon octfa fa-credit-card");
		}else if(this.frm.doc.docstatus == 1) {
			this.page.set_primary_action(__("Print"), function() {
				html = frappe.render(me.print_template_data, me.frm.doc)
				me.print_document(html)
			})
		}else {
			this.page.clear_primary_action()
		}

		this.page.set_secondary_action(__("New"), function() {
			me.save_previous_entry();
			me.create_new();
		}, "octicon octfa fa-plus").addClass("btn-primary");
	},

	print_dialog: function(){
		var me = this;

		msgprint = frappe.msgprint(format('<a class="btn btn-primary print_doc" \
			style="margin-right: 5px;">{0}</a>\
			<a class="btn btn-default new_doc">{1}</a>', [
			__('Print'), __('New')
		]));

		$('.print_doc').click(function(){
			html = frappe.render(me.print_template_data, me.frm.doc)
			me.print_document(html)
		})

		$('.new_doc').click(function(){
			msgprint.hide()
			me.create_new();
		})
	},

	print_document: function(html){
		var w = window.open();
		w.document.write(html);
		w.document.close();
		setTimeout(function(){
			w.print();
			w.close();
		}, 1000)
	},

	submit_invoice: function(){
		var me = this;
		this.change_status();
		if(this.frm.doc.docstatus == 1){
			this.print_dialog()
		}
	},

	change_status: function(){
		if(this.frm.doc.docstatus == 0){
			this.frm.doc.docstatus = 1;
			this.update_invoice();
			this.disable_input_field();
		}
	},

	disable_input_field: function(){
		var pointer_events = 'inherit'
		$(this.wrapper).find('input').attr("disabled", false);

		if(this.frm.doc.docstatus == 1){
			pointer_events = 'none';
			$(this.wrapper).find('input').attr("disabled", true);
		}

		$(this.wrapper).find('.pos-bill-wrapper').css('pointer-events', pointer_events);
		$(this.wrapper).find('.pos-items-section').css('pointer-events', pointer_events);
		this.set_primary_action();
	},

	create_invoice: function(){
		var me = this;
		var invoice_data = {}
		this.si_docs = this.get_doc_from_localstorage();
		if(this.name){
			this.update_invoice()
		}else{
			this.name = $.now();
			this.frm.doc.offline_pos_name = this.name;
			this.frm.doc.posting_date = frappe.datetime.get_today();
			this.frm.doc.posting_time = frappe.datetime.now_time();
			invoice_data[this.name] = this.frm.doc
			this.si_docs.push(invoice_data)
			this.update_localstorage();
			this.set_primary_action();
		}
	},

	update_invoice: function(){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();
		$.each(this.si_docs, function(index, data){
			for(key in data){
				if(key == me.name){
					me.si_docs[index][key] = me.frm.doc;
					me.update_localstorage();
				}
			}
		})
	},

	update_localstorage: function(){
		try{
			localStorage.setItem('sales_invoice_doc', JSON.stringify(this.si_docs));
		}catch(e){
			frappe.throw(__("LocalStorage is full , did not save"))
		}
	},

	get_doc_from_localstorage: function(){
		try{
			return JSON.parse(localStorage.getItem('sales_invoice_doc')) || [];
		}catch(e){
			return []
		}
	},

	set_interval_for_si_sync: function(){
		var me = this;
		setInterval(function(){
			me.sync_sales_invoice()
		}, 60000)
	},

	sync_sales_invoice: function(){
		var me = this;
		this.si_docs = this.get_submitted_invoice();

		if(this.si_docs.length){
			frappe.call({
				method: "erpnext.accounts.doctype.sales_invoice.pos.make_invoice",
				args: {
					doc_list: me.si_docs
				},
				callback: function(r){
					if(r.message){
						me.removed_items = r.message;
						me.remove_doc_from_localstorage();
					}
				}
			})
		}
	},

	get_submitted_invoice: function(){
		var invoices = [];
		var index = 1;
		docs = this.get_doc_from_localstorage();
		if(docs){
			invoices = $.map(docs, function(data){
				for(key in data){
					if(data[key].docstatus == 1 && index < 50){
						index++
						data[key].docstatus = 0;
						return data
					}
				}
			});
		}

		return invoices
	},

	remove_doc_from_localstorage: function(){
		var me = this;
		this.si_docs = this.get_doc_from_localstorage();
		this.new_si_docs = [];
		if(this.removed_items){
			$.each(this.si_docs, function(index, data){
				for(key in data){
					if(!in_list(me.removed_items, key)){
						me.new_si_docs.push(data);
					}
				}
			})
			this.si_docs = this.new_si_docs;
			this.update_localstorage();
		}
	},

	validate: function(){
		var me = this;
		this.customer_validate();
		this.item_validate();
		this.validate_mode_of_payments();
	},

	item_validate: function(){
		if(this.frm.doc.items.length == 0){
			frappe.throw(__("Select items to save the invoice"))
		}
	},
	
	validate_mode_of_payments: function(){
		if (this.frm.doc.payments.length === 0){
			frappe.throw(__("Payment Mode is not configured. Please check, whether account has been set on Mode of Payments or on POS Profile."))
		}
	},
	
	validate_serial_no: function(){
		var me = this;
		var item_code = serial_no = '';
		for (key in this.item_serial_no){
			item_code = key;
			serial_no = me.item_serial_no[key][0];
		}

		if(this.items[0].has_serial_no && serial_no == ""){
			this.refresh();
			frappe.throw(__(repl("Error: Serial no is mandatory for item %(item)s", {
				'item': this.items[0].item_code
			})))
		}

		if(item_code && serial_no){
			$.each(this.frm.doc.items, function(index, data){
				if(data.item_code == item_code){
					if(in_list(data.serial_no.split('\n'), serial_no)){
						frappe.throw(__(repl("Serial no %(serial_no)s is already taken", {
							'serial_no': serial_no
						})))
					}
				}
			})
		}
	},

	validate_serial_no_qty: function(args, item_code, field, value){
		var me = this;
		if (args.item_code == item_code && args.serial_no
			&& field == 'qty' && cint(value) != value) {
			args.qty = 0.0;
			this.refresh();
			frappe.throw(__("Serial no item cannot be a fraction"))
		}

		if(args.item_code == item_code && args.serial_no && args.serial_no.split('\n').length != cint(value)){
			args.qty = 0.0;
			args.serial_no = ''
			this.refresh();
			frappe.throw(__(repl("Total nos of serial no is not equal to quantity for item %(item)s.", {
				'item': item_code
			})))
		}
	},

	mandatory_batch_no: function(){
		var me = this;
		if(this.items[0].has_batch_no && !this.item_batch_no[this.items[0].item_code]){
			frappe.throw(__(repl("Error: Batch no is mandatory for item %(item)s", {
				'item': this.items[0].item_code
			})))
		}
	},

	apply_pricing_rule: function(){
		var me = this;
		$.each(this.frm.doc["items"], function(n, item) {
			pricing_rule = me.get_pricing_rule(item)
			me.validate_pricing_rule(pricing_rule)
			if(pricing_rule.length){
				item.margin_type = pricing_rule[0].margin_type;
				item.price_list_rate = pricing_rule[0].price || item.price_list_rate;
				item.margin_rate_or_amount = pricing_rule[0].margin_rate_or_amount;
				item.discount_percentage = pricing_rule[0].discount_percentage || 0.0;
				me.apply_pricing_rule_on_item(item)
			} else if(item.discount_percentage > 0 || item.margin_rate_or_amount > 0) {
				item.margin_rate_or_amount = 0.0;
				item.discount_percentage = 0.0;
				me.apply_pricing_rule_on_item(item)
			}
		})
	},

	get_pricing_rule: function(item){
		var me = this;
		return $.grep(this.pricing_rules, function(data){
			if(item.qty >= data.min_qty && (item.qty <= (data.max_qty ? data.max_qty : item.qty)) ){
				if(data.item_code == item.item_code || in_list(['All Item Groups', item.item_group], data.item_group)) {
					if(in_list(['Customer', 'Customer Group', 'Territory', 'Campaign'], data.applicable_for)){
						return me.validate_condition(data)
					}else{
						return true
					}
				}
			}
		})
	},

	validate_condition: function(data){
		//This method check condition based on applicable for
		condition = this.get_mapper_for_pricing_rule(data)[data.applicable_for]
		if(in_list(condition[1], condition[0])){
			return true
		}
	},

	get_mapper_for_pricing_rule: function(data){
		return {
			'Customer': [data.customer, [this.frm.doc.customer]],
			'Customer Group': [data.customer_group, [this.frm.doc.customer_group, 'All Customer Groups']],
			'Territory': [data.territory, [this.frm.doc.territory, 'All Territories']],
			'Campaign': [data.campaign, [this.frm.doc.campaign]],
		}
	},

	validate_pricing_rule: function(pricing_rule){
		//This method validate duplicate pricing rule
		var pricing_rule_name = '';
		var priority = 0;
		var pricing_rule_list = [];
		var priority_list = []

		if(pricing_rule.length > 1){

			$.each(pricing_rule, function(index, data){
				pricing_rule_name += data.name + ','
				priority_list.push(data.priority)
				if(priority <= data.priority){
					priority = data.priority
					pricing_rule_list.push(data)
				}
			})

			count = 0
			$.each(priority_list, function(index, value){
				if(value == priority){
					count++
				}
			})

			if(priority == 0 || count > 1){
				frappe.throw(__(repl("Multiple Price Rules exists with same criteria, please resolve conflict by assigning priority. Price Rules: %(pricing_rule)s", {
					'pricing_rule': pricing_rule_name
				})))
			}

			return pricing_rule_list
		}
	},

	validate_warehouse: function(){
		if(this.items[0].is_stock_item && !this.items[0].default_warehouse && !this.pos_profile_data['warehouse']){
			frappe.throw(__("Default warehouse is required for selected item"))
		}
	},

	get_actual_qty: function(item) {
		this.actual_qty = 0.0;

		var warehouse = this.pos_profile_data['warehouse'] || item.default_warehouse;
		if(warehouse && this.bin_data[item.item_code]) {
			this.actual_qty = this.bin_data[item.item_code][warehouse] || 0;
			this.actual_qty_dict[item.item_code] = this.actual_qty
		}

		return this.actual_qty
	}
})