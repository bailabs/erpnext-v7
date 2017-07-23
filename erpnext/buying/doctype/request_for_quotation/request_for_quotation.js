// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt


{% include 'erpnext/buying/doctype/purchase_common/purchase_common.js' %};

cur_frm.add_fetch('contact', 'email_id', 'email_id')

frappe.ui.form.on("Request for Quotation",{
	setup: function(frm) {
		frm.custom_make_buttons = {
			'Supplier Quotation': 'Supplier Quotation'
		}

		frm.fields_dict["suppliers"].grid.get_field("contact").get_query = function(doc, cdt, cdn){
			var d =locals[cdt][cdn];
			return {
				filters: {'supplier': d.supplier}
			}
		}
	},

	onload: function(frm) {
		frm.add_fetch('standard_reply', 'response', 'message_for_supplier');

		if(!frm.doc.message_for_supplier) {
			frm.set_value("message_for_supplier", __("Please supply the specified items at the best possible rates"))
		}
	},

	refresh: function(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(__("Make"),
				function(){ frm.trigger("make_suppplier_quotation") }, __("Supplier Quotation"));

			frm.add_custom_button(__("View"),
				function(){ frappe.set_route('List', 'Supplier Quotation',
					{'request_for_quotation': frm.doc.name}) }, __("Supplier Quotation"));

			frm.add_custom_button(__("Send Supplier Emails"), function() {
				frappe.call({
					method: 'erpnext.buying.doctype.request_for_quotation.request_for_quotation.send_supplier_emails',
					freeze: true,
					args: {
						rfq_name: frm.doc.name
					}
				});
			});
		}
	},

	make_suppplier_quotation: function(frm) {
		var doc = frm.doc;
		var dialog = new frappe.ui.Dialog({
			title: __("For Supplier"),
			fields: [
				{"fieldtype": "Select", "label": __("Supplier"),
					"fieldname": "supplier", "options":"Supplier",
					"options": $.map(doc.suppliers,
						function(d) { return d.supplier }), "reqd": 1 },
				{"fieldtype": "Button", "label": __("Make Supplier Quotation"),
					"fieldname": "make_supplier_quotation", "cssClass": "btn-primary"},
			]
		});

		dialog.fields_dict.make_supplier_quotation.$input.click(function() {
			args = dialog.get_values();
			if(!args) return;
			dialog.hide();
			return frappe.call({
				type: "GET",
				method: "erpnext.buying.doctype.request_for_quotation.request_for_quotation.make_supplier_quotation",
				args: {
					"source_name": doc.name,
					"for_supplier": args.supplier
				},
				freeze: true,
				callback: function(r) {
					if(!r.exc) {
						var doc = frappe.model.sync(r.message);
						frappe.set_route("Form", r.message.doctype, r.message.name);
					}
				}
			});
		});
		dialog.show()
	}
})

frappe.ui.form.on("Request for Quotation Supplier",{
	supplier: function(frm, cdt, cdn) {
		var d = locals[cdt][cdn]
		frappe.call({
			method:"erpnext.accounts.party.get_party_details",
			args:{
				party: d.supplier,
				party_type: 'Supplier'
			},
			callback: function(r){
				if(r.message){
					frappe.model.set_value(cdt, cdn, 'contact', r.message.contact_person)
					frappe.model.set_value(cdt, cdn, 'email_id', r.message.contact_email)
				}
			}
		})
	},

	download_pdf: function(frm, cdt, cdn) {
		var child = locals[cdt][cdn]

		var w = window.open(
			frappe.urllib.get_full_url("/api/method/erpnext.buying.doctype.request_for_quotation.request_for_quotation.get_pdf?"
			+"doctype="+encodeURIComponent(frm.doc.doctype)
			+"&name="+encodeURIComponent(frm.doc.name)
			+"&supplier_idx="+encodeURIComponent(child.idx)
			+"&no_letterhead=0"));
		if(!w) {
			msgprint(__("Please enable pop-ups")); return;
		}
	}
})

erpnext.buying.RequestforQuotationController = erpnext.buying.BuyingController.extend({
	refresh: function() {
		this._super();
		if (this.frm.doc.docstatus===0) {
			cur_frm.add_custom_button(__('Material Request'),
				function() {
					erpnext.utils.map_current_doc({
						method: "erpnext.stock.doctype.material_request.material_request.make_request_for_quotation",
						source_doctype: "Material Request",
						get_query_filters: {
							material_request_type: "Purchase",
							docstatus: 1,
							status: ["!=", "Stopped"],
							per_ordered: ["<", 99.99],
							company: cur_frm.doc.company
						}
					})
				}, __("Get items from"));
		}
	},

	calculate_taxes_and_totals: function() {
		return;
	},

	tc_name: function() {
		this.get_terms();
	}
});


// for backward compatibility: combine new and previous states
$.extend(cur_frm.cscript, new erpnext.buying.RequestforQuotationController({frm: cur_frm}));
