import sys,fitz
sys.stdout.reconfigure(encoding='utf-8')
d=fitz.open(sys.argv[1])
for p in range(int(sys.argv[2]),int(sys.argv[3])+1):
    pg=d[p-1]; print('=====PAGE',p)
    ws=pg.get_text('words')
    ws.sort(key=lambda w:(round(w[1]),w[0]))
    rows=[]
    for w in ws:
        if rows and abs(rows[-1][0]-w[1])<3: rows[-1][1].append(w)
        else: rows.append([w[1],[w]])
    for y,r in rows:
        r.sort(key=lambda w:w[0])
        print(int(y),' | '.join(f"{int(w[0])}:{w[4]}" for w in r))
