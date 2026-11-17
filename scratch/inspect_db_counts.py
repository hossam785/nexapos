import sqlite3
import os

DB_PATH = r"C:\Users\20114\AppData\Roaming\NEXA\mgpos.db"

if os.path.exists(DB_PATH):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    print("TABLES & ROW COUNTS:")
    for t in sorted(tables):
        try:
            cursor.execute(f"SELECT count(*) FROM {t}")
            cnt = cursor.fetchone()[0]
            if cnt > 0:
                print(f"  {t}: {cnt}")
        except Exception as e:
            pass
    conn.close()
else:
    print("Database not found")
