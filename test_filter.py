import sqlite3

conn = sqlite3.connect('C:\\Users\\HP\\AppData\\Roaming\\MGIVIA\\mgpos.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT * FROM day_closings WHERE date = '2026-04-30' AND status = 'open'")
print('NO USER FILTER:', len(cur.fetchall()))

cur.execute("SELECT * FROM day_closings WHERE date = '2026-04-30' AND status = 'open' AND opened_by_user_id = '1'")
print('USER FILTER STRING:', len(cur.fetchall()))

cur.execute("SELECT * FROM day_closings WHERE date = '2026-04-30' AND status = 'open' AND opened_by_user_id = 1")
print('USER FILTER INT:', len(cur.fetchall()))

