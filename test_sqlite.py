import sqlite3
import json

conn = sqlite3.connect('C:\\Users\\HP\\AppData\\Roaming\\MGIVIA\\mgpos.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Get latest open shift
cur.execute("SELECT id, shift_opened_at, opened_by_user_id FROM day_closings WHERE status='open' ORDER BY id DESC LIMIT 1")
open_shift = dict(cur.fetchone() or {})
print('OPEN SHIFT:', json.dumps(open_shift))

if open_shift:
    shift_time = open_shift.get('shift_opened_at')
    
    cur.execute("SELECT COUNT(*), SUM(total) FROM invoices WHERE DATE(created_at) = DATE('now')")
    print('ALL SALES TODAY:', tuple(cur.fetchone()))
    
    cur.execute("SELECT COUNT(*), SUM(total) FROM invoices WHERE DATE(created_at) = DATE('now') AND datetime(created_at) >= datetime(?)", (shift_time,))
    print('SALES AFTER SHIFT OPENED:', tuple(cur.fetchone()))
    
    cur.execute("SELECT COUNT(*), SUM(total) FROM invoices WHERE DATE(created_at) = DATE('now') AND created_at >= ?", (shift_time,))
    print('SALES AFTER SHIFT (STRING COMPARE):', tuple(cur.fetchone()))
    
    cur.execute("SELECT created_at FROM invoices ORDER BY id DESC LIMIT 1")
    last_invoice = cur.fetchone()
    print('LATEST INVOICE TIME:', last_invoice[0] if last_invoice else None)

