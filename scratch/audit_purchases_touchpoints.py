import os, glob

base_dir = r'c:\Users\20114\Documents\hossam hamada\MGIVIA\src'

results = {}

for root, dirs, files in os.walk(base_dir):
    for f in files:
        if f.endswith(('.js', '.jsx')):
            fpath = os.path.join(root, f)
            rel_path = os.path.relpath(fpath, base_dir)
            with open(fpath, 'r', encoding='utf-8', errors='ignore') as fp:
                content = fp.read()
            
            # Check for purchase_invoices or purchase_items or suppliersDB
            has_pi = 'purchase_invoices' in content
            has_pit = 'purchase_items' in content
            has_cpi = 'createPurchaseInvoice' in content
            has_gpi = 'getPurchaseInvoice' in content
            has_supp = 'supplier_transactions' in content
            
            if has_pi or has_pit or has_cpi or has_gpi or has_supp:
                results[rel_path] = {
                    'purchase_invoices': has_pi,
                    'purchase_items': has_pit,
                    'createPurchaseInvoice': has_cpi,
                    'getPurchaseInvoice': has_gpi,
                    'supplier_transactions': has_supp,
                }

with open(r'c:\Users\20114\Documents\hossam hamada\MGIVIA\scratch\search_results.txt', 'w', encoding='utf-8') as out:
    for path, flags in results.items():
        active = [k for k, v in flags.items() if v]
        out.write(f"{path}: {', '.join(active)}\n")

print(f"Total matching files: {len(results)}")
