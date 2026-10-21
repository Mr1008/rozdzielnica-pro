import pymupdf, re, json, sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')
BASE = r'C:\Users\JMICHA~1\AppData\Local\Temp\claude\C--Users-jmichalek-Git-FP-10x\08b05b83-49f4-47b8-8611-4a03f1a47e4a\scratchpad'
d = pymupdf.open(BASE + r'\pdf\eaton.pdf')


def rows(p):
    ws = d[p - 1].get_text('words')
    ws.sort(key=lambda w: (round(w[1]), w[0]))
    rs = []
    for w in ws:
        if rs and abs(rs[-1][0] - w[1]) < 3:
            rs[-1][1].append(w)
        else:
            rs.append([w[1], [w]])
    out = []
    for y, r in rs:
        r.sort(key=lambda w: w[0])
        s = ''
        px = None
        for w in r:
            if px is not None:
                s += ' | ' if w[0] - px > 14 else ' '
            s += w[4]
            px = w[2]
        out.append(s)
    return out


WEB = {
    'PF6': 'https://www.eaton.com/us/en-us/skuPage.286492.html ; https://www.eaton.com/us/en-us/skuPage.286504.html',
    'FRCmM': 'https://www.eaton.com/us/en-us/skuPage.170411.html',
    'FRBm6': 'https://www.eaton.com/at/en-gb/skuPage.170986.html',
    'HNB': 'https://datasheet.eaton.com/datasheet.php?model=195121&locale=pl_PL ; https://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/circuit-breakers/xpole-home-series---rcbo/poland/eaton-xpole-home-catalogue-pl.pdf',
    'PFL6': 'https://datasheet.eaton.com/datasheet.php?model=112875&locale=en_GB ; https://www.eaton.com/gb/en-gb/skuPage.286431.html',
    'PKNM': 'https://www.eaton.com/gb/en-gb/skuPage.236200.html',
}
cfg = {11: 'HNC', 14: 'PF6', 15: 'PF6', 18: 'FRCmM', 19: 'FRCmM', 20: 'FRCmM', 21: 'FRCmM', 22: 'FRCmM',
       24: 'FRCdM', 25: 'FRCdM', 28: 'PFIM', 29: 'PFIM', 30: 'PFIM',
       69: 'HNB', 72: 'PFL6', 73: 'PFL6', 76: 'PKNM', 77: 'PKNM', 78: 'PKNM', 79: 'PKNM', 82: 'FRBm6', 83: 'FRBm6'}
MP = {'AC': 'AC', 'A': 'A', 'G': 'AC', 'G/A': 'A', 'G/F': 'F', 'F': 'F', 'S': 'AC', 'S/A': 'A', 'S/F': 'F',
      'G/B': 'B', 'S/B': 'B', 'G/B+': 'B', 'S/B+': 'B', 'G/Bfq': 'B', 'S/Bfq': 'B'}
seen = set()
res = []
for p, ser in cfg.items():
    char = None
    for ln in rows(p):
        mc = re.match(r'Charakterystyka (\w)', ln)
        if mc:
            char = mc.group(1)
        m = re.match(r'^([\d,\.]+)/([\d,\.]+) \| (\S+)(?: \| (\S+))?', ln)
        if not m:
            continue
        model = m.group(3)
        if model in seen:
            continue
        seen.add(model)
        no = m.group(4) if m.group(4) and re.fullmatch(r'\d{6}', m.group(4)) else None
        res.append((p, ser, model, no, int(m.group(1)), m.group(2), char))

out = []
skipped = Counter()
for p, ser, model, no, In, ma_s, char in res:
    ma = round(float(ma_s.replace(',', '.')) * 1000)
    code = re.search(r'/(003|01|03|05)(?:-|$)', model).group(1)
    ma_code = {'003': 30, '01': 100, '03': 300, '05': 500}[code]
    kind = 'rcbo' if ser in ('HNB', 'PFL6', 'PKNM', 'FRBm6') else 'rcd'
    if kind == 'rcd':
        poles = {'2': '2P', '4': '4P'}[re.search(r'-\d+/([24])/', model).group(1)]
    else:
        poles = '3P+N' if '3N' in model else '1P+N'
    suf = re.search(r'/0?\d+(?:-(.+))?$', model).group(1) or ''
    raw = suf if suf else 'AC'
    base = raw.replace('-MW', '')
    t = MP[base]
    flag = []
    if base.startswith('S') or base.startswith('G'):
        flag.append(f'time-delayed type ({base[0]}) mapped to base sensitivity {t}; delay not representable in schema')
    if 'B+' in base:
        flag.append('B+ (raised fire protection) mapped to B; verify')
    if 'Bfq' in base:
        flag.append('Bfq (frequency-converter characteristic) mapped to B; verify')
    mods = {'2P': 2, '4P': 4, '1P+N': 2, '3P+N': 4}[poles]
    src = 'inferred from pole count (not stated in PDF)'
    h = dep = None
    web = WEB.get(ser)
    notes = []
    if ma_code != ma:
        notes.append(f'PDF table column says {ma_s} A, model code says {ma_code} mA; model code used')
    if ser == 'PF6':
        h, dep = 80, 69.5
    if ser == 'FRCmM' and In <= 100:
        h, dep = 80, 70.5
        if poles == '2P':
            notes.append('h/depth from FRCmM 4P 40A page, assumed same for 2P')
    if ser == 'FRCmM' and In == 125:
        web = None
    if ser == 'FRBm6':
        h, dep = 75.5, 75.5
    if ser in ('HNB', 'PFL6'):
        h, dep = 80, 69.5
    if ser == 'PKNM':
        h, dep = 80, 70
        notes.append('PKNM height 75 on product page vs 80 in catalog; 80 used')
        src = 'PDF p75: Szerokosc 2 mod.'
    if ser == 'FRCdM' and poles == '2P':
        src = 'PDF p25: 1-fazowe, szerokosc 4-bieg. (4 modules)'
        mods = 4
    if ser == 'FRCdM' and poles == '4P':
        src = 'inferred (4-pole; accessory Z-RC/AK-4TE)'
    if h is not None and web:
        notes.append('h/depth(built-in) web: ' + web)
    else:
        notes.append('height/depth not available')
    notes.append('modules: ' + src)
    if no is None:
        notes.append('order no. missing in PDF text layer (p29 repeats model in cat. column)')
    notes += flag
    if kind == 'rcd':
        name = f'Wyłącznik różnicowoprądowy {ser} {In}A {poles} {ma}mA typ {raw}'
    else:
        name = f'Wyłącznik różnicowoprądowo-nadprądowy {ser} {char}{In} {poles} {ma}mA typ {raw}'
    if kind == 'rcbo' and char != 'B':
        skipped[f'{ser}_{char}'] += 1
        continue
    out.append(dict(kind=kind, manufacturer='Eaton', series=ser, model=model, order_no=no, name=name, poles=poles,
                    rated_current_a=In, residual_current_ma=ma_code, rcd_type=t, rcd_type_raw=raw,
                    breaking_capacity_ka={'HNB': 6, 'PFL6': 6, 'PKNM': 10, 'FRBm6': 6}.get(ser) if kind == 'rcbo' else None,
                    characteristic=char if kind == 'rcbo' else None, modules=mods, width_mm=mods * 17.5,
                    height_mm=h, depth_mm=dep, n_terminal_side=None, page=p, notes='; '.join(notes)))
json.dump(out, open(BASE + r'\extract\eaton-rcd-rcbo.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out))
print(Counter((o['series'], o['kind']) for o in out))
print(skipped)
print(Counter(o['rcd_type'] for o in out))
print(Counter(o['residual_current_ma'] for o in out))
print([o['model'] for o in out if o['order_no'] is None])
