import sys,re,json
sys.stdout.reconfigure(encoding='utf-8')
t=open('../pdf/legrand.txt',encoding='cp1250',errors='replace').read().split('\f')
ORD=re.compile(r'(?<![\d])(\d{4} \d{2})(?!\d{2})')
DES=re.compile(r'\b([SP]) ?(3\d\d)(N?) ((?:[BCD]\d+(?:,\d)?)|(?:\d+-\d+-\w+)|(?:[BC]\d+-\d+-\w+)) ?-?(\w*?)\s*(DX|TX|RX)?\b')
res={}
def rows(pn):
    txt=t[pn-1]
    i=txt.find('Pak.')
    body=txt[i:] if i>=0 else txt
    # designations: capture full token incl -AC DX
    des=re.findall(r'\b([SP] ?3\d\d N?)\s+([A-Z]?\d+(?:,\d)?(?:-\d+-[A-Z]+)?(?:[A-Z]*))\s*(DX|TX|RX)?',body)
    return body
for pn in list(range(7,9))+list(range(11,22))+list(range(26,42)):
    body=rows(pn)
    ords=[m.group(1) for m in ORD.finditer(body)]
    des=re.findall(r'\b([SP] ?3\d\d ?N?) ((?:[BCD]\d+(?:,\d)?(?:-\d+-[A-Z]+)?(?:-[A-Z]+)?)|(?:\d+-\d+-[A-Z]+))(?: ?(DX|TX|RX))?',body)
    des2=[' '.join(d).strip() for d in des]
    print(pn,len(ords),len(des2), 'OK' if len(ords)==len(des2) else 'MISMATCH')
