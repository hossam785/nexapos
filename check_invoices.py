import sqlite3
import json

conn = sqlite3.connect('C:\\Users\\HP\\AppData\\Roaming\\MGIVIA\\mgpos.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT * FROM invoices WHERE DATE(created_at) = '2026-04-30' AND (payment_method='credit' OR payment_method='card')")
rows = [dict(r) for r in cur.fetchall()]
print(json.dumps(rows, indent=2))


