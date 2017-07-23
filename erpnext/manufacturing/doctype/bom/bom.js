// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.bom");

frappe.ui.form.on("BOM", {
	setup: function(frm) {
		frm.add_fetch('buying_price_list', 'currency', 'currency')
		frm.fields_dict["items"].grid.get_field("bom_no").get_query = function(doc, cdt, cdn){
			return {
				filters: {'currency': frm.doc.currency}
			}
		}
	},

	onload_post_render: function(frm) {
		frm.get_field("items").grid.set_multiple_add("item_code", "qty");
	},

	refresh: function(frm) {
		frm.toggle_enable("item", frm.doc.__islocal);
		toggle_operations(frm);

		if (!frm.doc.__islocal && frm.doc.docstatus<2) {
			frm.add_custom_button(__("Update Cost"), function() {
				frm.events.update_cost(frm);
			});
			frm.add_custom_button(__("Browse BOM"), function() {
				frappe.route_options = {
					"bom": frm.doc.name
				};
				frappe.set_route("Tree", "BOM");
			});
		}

		if(frm.doc.docstatus==2) {
			// show duplicate button when BOM is cancelled,
			// its not very intuitive
			frm.add_custom_button(__("Duplicate"), function() {
				frm.copy_doc();
			});
		}
	},

	update_cost: function(frm) {
		return frappe.call({
			doc: frm.doc,
			method: "update_cost",
			freeze: true,
			callback: function(r) {
				if(!r.exc) frm.refresh_fields();
			}
		})
	}
});

erpnext.bom.BomController = erpnext.TransactionController.extend({
	conversion_rate: function(doc, cdt, cdn) {
		if(this.frm.doc.currency === this.get_company_currency()) {
			this.frm.set_value("conversion_rate", 1.0);
		} else {
			erpnext.bom.update_cost(doc);
		}
	},
	
	item_code: function(doc, cdt, cdn){
		var scrap_items = false;
		child = locals[cdt][cdn];
		if(child.doctype == 'BOM Scrap Item') {
			scrap_items = true;
		}

		get_bom_material_detail(doc, cdt, cdn, scrap_items);
	},
})

$.extend(cur_frm.cscript, new erpnext.bom.BomController({frm: cur_frm}));

cur_frm.add_fetch("item", "description", "description");
cur_frm.add_fetch("item", "image", "image");
cur_frm.add_fetch("item", "item_name", "item_name");
cur_frm.add_fetch("item", "stock_uom", "uom");


cur_frm.cscript.hour_rate = function(doc, dt, dn) {
	erpnext.bom.calculate_op_cost(doc);
	erpnext.bom.calculate_total(doc);
}

cur_frm.cscript.time_in_mins = cur_frm.cscript.hour_rate;

cur_frm.cscript.bom_no	= function(doc, cdt, cdn) {
	get_bom_material_detail(doc, cdt, cdn, false);
}

cur_frm.cscript.is_default = function(doc) {
	if (doc.is_default) cur_frm.set_value("is_active", 1);
}

var get_bom_material_detail= function(doc, cdt, cdn, scrap_items) {
	var d = locals[cdt][cdn];
	if (d.item_code) {
		return frappe.call({
			doc: doc,
			method: "get_bom_material_detail",
			args: {
				'item_code': d.item_code,
				'bom_no': d.bom_no != null ? d.bom_no: '',
				"scrap_items": scrap_items,
				'qty': d.qty
			},
			callback: function(r) {
				d = locals[cdt][cdn];
				$.extend(d, r.message);
				refresh_field("items");
				refresh_field("scrap_items");
				doc = locals[doc.doctype][doc.name];
				erpnext.bom.calculate_rm_cost(doc);
				erpnext.bom.calculate_scrap_materials_cost(doc);
				erpnext.bom.calculate_total(doc);
			},
			freeze: true
		});
	}
}

cur_frm.cscript.qty = function(doc, cdt, cdn) {
	erpnext.bom.calculate_rm_cost(doc);
	erpnext.bom.calculate_scrap_materials_cost(doc);
	erpnext.bom.calculate_total(doc);
}

cur_frm.cscript.rate = function(doc, cdt, cdn) {
	var d = locals[cdt][cdn];
	var scrap_items = false;

	if(child.doctype == 'BOM Scrap Item') {
		scrap_items = true;
	}

	if (d.bom_no) {
		msgprint(__("You can not change rate if BOM mentioned agianst any item"));
		get_bom_material_detail(doc, cdt, cdn, scrap_items);
	} else {
		erpnext.bom.calculate_rm_cost(doc);
		erpnext.bom.calculate_scrap_materials_cost(doc);
		erpnext.bom.calculate_total(doc);
	}
}

erpnext.bom.update_cost = function(doc) {
	erpnext.bom.calculate_op_cost(doc);
	erpnext.bom.calculate_rm_cost(doc);
	erpnext.bom.calculate_scrap_materials_cost(doc);
	erpnext.bom.calculate_total(doc);
}

erpnext.bom.calculate_op_cost = function(doc) {
	var op = doc.operations || [];
	doc.operating_cost = 0.0;
	doc.base_operating_cost = 0.0;

	for(var i=0;i<op.length;i++) {
		operating_cost = flt(flt(op[i].hour_rate) * flt(op[i].time_in_mins) / 60, 2);
		base_operating_cost = flt(flt(op[i].base_hour_rate) * flt(op[i].time_in_mins) / 60, 2);
		frappe.model.set_value('BOM Operation',op[i].name, "operating_cost", operating_cost);
		frappe.model.set_value('BOM Operation',op[i].name, "base_operating_cost", base_operating_cost);

		doc.operating_cost += operating_cost;
		doc.base_operating_cost += base_operating_cost;
	}
	refresh_field(['operating_cost', 'base_operating_cost']);
}

// rm : raw material
erpnext.bom.calculate_rm_cost = function(doc) {
	var rm = doc.items || [];
	total_rm_cost = 0;
	base_total_rm_cost = 0;
	for(var i=0;i<rm.length;i++) {
		amount = flt(rm[i].rate) * flt(rm[i].qty);
		base_amount = flt(rm[i].rate) * flt(doc.conversion_rate) * flt(rm[i].qty);
		frappe.model.set_value('BOM Item', rm[i].name, 'base_rate', flt(rm[i].rate) * flt(doc.conversion_rate))
		frappe.model.set_value('BOM Item', rm[i].name, 'amount', amount)
		frappe.model.set_value('BOM Item', rm[i].name, 'qty_consumed_per_unit', flt(rm[i].qty)/flt(doc.quantity))
		frappe.model.set_value('BOM Item', rm[i].name, 'base_amount', base_amount)
		total_rm_cost += amount;
		base_total_rm_cost += base_amount;
	}
	cur_frm.set_value("raw_material_cost", total_rm_cost);
	cur_frm.set_value("base_raw_material_cost", base_total_rm_cost);
}

//sm : scrap material
erpnext.bom.calculate_scrap_materials_cost = function(doc) {
	var sm = doc.scrap_items || [];
	total_sm_cost = 0;
	base_total_sm_cost = 0;

	for(var i=0;i<sm.length;i++) {
		base_rate = flt(sm[i].rate) * flt(doc.conversion_rate);
		amount =	flt(sm[i].rate) * flt(sm[i].qty);
		base_amount =	flt(sm[i].rate) * flt(sm[i].qty) * flt(doc.conversion_rate);
		frappe.model.set_value('BOM Scrap Item',sm[i].name, 'base_rate', base_rate);
		frappe.model.set_value('BOM Scrap Item',sm[i].name, 'amount', amount);
		frappe.model.set_value('BOM Scrap Item',sm[i].name, 'base_amount', base_amount);
		
		total_sm_cost += amount;
		base_total_sm_cost += base_amount;
	}
	
	cur_frm.set_value("scrap_material_cost", total_sm_cost);
	cur_frm.set_value("base_scrap_material_cost", base_total_sm_cost);
}

// Calculate Total Cost
erpnext.bom.calculate_total = function(doc) {
	total_cost = flt(doc.operating_cost) + flt(doc.raw_material_cost) - flt(doc.scrap_material_cost);
	base_total_cost = flt(doc.base_operating_cost) + flt(doc.base_raw_material_cost) - flt(doc.base_scrap_material_cost);
	cur_frm.set_value("total_cost", total_cost);
	cur_frm.set_value("base_total_cost", base_total_cost);
}


cur_frm.fields_dict['item'].get_query = function(doc) {
 	return{
		query: "erpnext.controllers.queries.item_query"
	}
}

cur_frm.fields_dict['project'].get_query = function(doc, dt, dn) {
	return{
		filters:[
			['Project', 'status', 'not in', 'Completed, Cancelled']
		]
	}
}

cur_frm.fields_dict['items'].grid.get_field('item_code').get_query = function(doc) {
	return{
		query: "erpnext.controllers.queries.item_query",
		filters: [["Item", "name", "!=", cur_frm.doc.item]]
	}
}

cur_frm.fields_dict['items'].grid.get_field('bom_no').get_query = function(doc, cdt, cdn) {
	var d = locals[cdt][cdn];
	return{
		filters:{
			'item': d.item_code,
			'is_active': 1,
			'docstatus': 1
		}
	}
}

cur_frm.cscript.validate = function(doc, dt, dn) {
	erpnext.bom.update_cost(doc)
}

frappe.ui.form.on("BOM Operation", "operation", function(frm, cdt, cdn) {
	var d = locals[cdt][cdn];

	if(!d.operation) return;

	frappe.call({
		"method": "frappe.client.get",
		args: {
			doctype: "Operation",
			name: d.operation
		},
		callback: function (data) {
			if(data.message.description) {
				frappe.model.set_value(d.doctype, d.name, "description", data.message.description);
			}
			if(data.message.workstation) {
				frappe.model.set_value(d.doctype, d.name, "workstation", data.message.workstation);
			}
		}
	})
});

frappe.ui.form.on("BOM Operation", "workstation", function(frm, cdt, cdn) {
	var d = locals[cdt][cdn];

	frappe.call({
		"method": "frappe.client.get",
		args: {
			doctype: "Workstation",
			name: d.workstation
		},
		callback: function (data) {
			frappe.model.set_value(d.doctype, d.name, "hour_rate", data.message.hour_rate);
			frappe.model.set_value(d.doctype, d.name, "base_hour_rate", flt(data.message.hour_rate) * flt(frm.doc.conversion_rate));
			erpnext.bom.calculate_op_cost(frm.doc);
			erpnext.bom.calculate_total(frm.doc);
		}
	})
});

frappe.ui.form.on("BOM Operation", "operations_remove", function(frm) {
	erpnext.bom.calculate_op_cost(frm.doc);
	erpnext.bom.calculate_total(frm.doc);
});

frappe.ui.form.on("BOM Item", "items_remove", function(frm) {
	erpnext.bom.calculate_rm_cost(frm.doc);
	erpnext.bom.calculate_total(frm.doc);
});

var toggle_operations = function(frm) {
	frm.toggle_display("operations_section", cint(frm.doc.with_operations) == 1);
}

frappe.ui.form.on("BOM", "with_operations", function(frm) {
	if(!cint(frm.doc.with_operations)) {
		frm.set_value("operations", []);
	}
	toggle_operations(frm);
});

cur_frm.cscript.image = function() {
	refresh_field("image_view");
}
