import sys,re,json
sys.stdout.reconfigure(encoding='utf-8')
t=open('../pdf/legrand.txt',encoding='cp1250',errors='replace').read().split('\f')
ORD=re.compile(r'(?<![\d])(\d{4} \d{2})(?!\d{2})')
DES=re.compile(r'\b([SP]) ?(3\d\d) ?(N?) ((?:[BCD]\d+(?:,\d)?(?:-\d+-[A-Z]+)?(?:-[A-Z]+)?)|(?:\d+-\d+-[A-Z]+))(?: ?(DX|TX|RX))?')
out=[]
POLES={('S','1',''):'1P',('S','1','N'):'1P+N',('S','2',''):'2P',('S','3',''):'3P',('S','4',''):'4P'}
def poles_mcb(n):  # n = 301..304,311..314
    return {'1':'1P','2':'2P','3':'3P','4':'4P'}[n[2]]
for pn in list(range(7,9))+list(range(11,22))+list(range(26,35))+list(range(37,42)):
    txt=t[pn-1]; i=txt.find('Pak.'); body=txt[i:]
    ords=[m.group(1) for m in ORD.finditer(body)]
    des=DES.findall(body)
    assert len(ords)==len(des),pn
    for o,(L,num,N,code,suf) in zip(ords,des):
        suf=suf or ''
        sfx=re.search(r'(DX|TX|RX)',body[body.find(code):body.find(code)+40])
        if suf=='' and code.endswith(('DX','TX','RX')):
            suf=code[-2:]; code=code[:-2]
        ser={'DX':'DX3','TX':'TX3','RX':'RX3'}
        if code.endswith(('ADX','ATX')) : pass
        rec=dict(page=pn,order_no=o,L=L,num=num,N=N,code=code,suf=suf)
        out.append(rec)
json.dump(out,open('raw.json','w'),ensure_ascii=False)
for r in out:
    if r['L']=='S' and r['code'].startswith('B'): print(r['page'],r['order_no'],r['num'],r['N'],r['code'],r['suf'])
