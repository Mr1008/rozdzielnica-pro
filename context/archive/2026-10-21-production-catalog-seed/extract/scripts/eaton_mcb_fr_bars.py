import sys,re,json,pymupdf,os
sys.stdout.reconfigure(encoding='utf-8')
SP=os.environ['SP']
d=pymupdf.open(SP+'/pdf/eaton.pdf')
rows=[]
W_PL='https://www.eaton.com/us/en-us/skuPage.286521.html'
def lines(n): return [l.strip() for l in d[n-1].get_text().split('\n')]
POLES={'1':'1P','1N':'1P+N','2':'2P','3':'3P','3N':'3P+N','4':'4P'}
MOD={'1P':1,'1P+N':2,'2P':2,'3P':3,'3P+N':4,'4P':4}
def mcb(series,pages,pat,bka,h,dep,note):
    for n in pages:
        L=lines(n)
        for i,l in enumerate(L):
            m=re.match(pat,l)
            if m and i+1<len(L) and re.match(r'^\d{5,6}$',L[i+1]):
                cur=int(m.group('i')); poles=POLES[m.group('s')]
                mod=MOD[poles]
                rows.append(dict(kind='mcb_b',manufacturer='Eaton',series=series,model=l,order_no=L[i+1],
                  name=f'Wyłącznik nadprądowy {series} B{cur} {poles}',poles=poles,rated_current_a=cur,
                  breaking_capacity_ka=bka,characteristic='B',modules=mod,width_mm=mod*17.5,length_mm=None,
                  height_mm=h,depth_mm=dep,n_terminal_side=None,terminal_groups=None,page=n,notes=note))
base='Modules/width inferred from pole count (catalog has photos only; 1+N=2 modules per eaton.com SKU page for PL6-B16/1N). N-terminal side not stated in PDF or found on web.'
mcb('PL6',[44,45],r'^PL6-B(?P<i>\d+)/(?P<s>1N|1|2|3N|3|4)$',6,80,70.5,base+' Height 80 = family catalog (SKU page says 73); depth = built-in depth 70.5 ('+W_PL+').')
mcb('HN',[40],r'^HN-B(?P<i>\d+)/(?P<s>1N|1|2|3N|3|4)$',6,80,44,base+' Height 80 = family catalog (SKU 194821 page says 73, https://www.eaton.com/us/en-us/skuPage.194821.html); depth 44 = built-in depth from that page. No 4P / 2 A / 4 A in HN-B.')
mcb('FAZ',[52,53],r'^FAZ-B(?P<i>[\d,]+)/(?P<s>1N|1|2|3N|3|4)$',15,80,70.5,base+' Height 80 = family catalog, SKU 278535 page says 75.5/depth 80; built-in depth 70.5 (https://www.eaton.com/us/en-us/skuPage.278535.html).')
L=lines(64)
for i,l in enumerate(L):
    m=re.match(r'^AZ-(?:(?P<p>2|3N|3|4)-)?B(?P<i>\d+)$',l)
    if m and re.match(r'^\d{6}$',L[i+1]):
        pm={None:'1P','2':'2P','3':'3P','3N':'3P+N','4':'4P'}[m.group('p')]
        cur=int(m.group('i')); np_={'1P':1,'2P':2,'3P':3,'3P+N':4,'4P':4}[pm]
        rows.append(dict(kind='mcb_b',manufacturer='Eaton',series='AZ',model=l,order_no=L[i+1],name=f'Wyłącznik nadprądowy AZ B{cur} {pm}',poles=pm,rated_current_a=cur,
          breaking_capacity_ka=25 if cur<125 else 15,characteristic='B',modules=1.5*np_,width_mm=27*np_,length_mm=None,height_mm=90,depth_mm=75,n_terminal_side=None,terminal_groups=None,page=64,
          notes='AZ xEffect is 1.5 modules (27 mm) per pole: width_mm = 27 x poles, not modules x 17.5. PDF p63: 25 kA per EN 60947-2 (not EN 60898); eaton.com SKU 174488 shows 15 kA at 400 V for 125 A (https://www.eaton.com/es/es-es/skuPage.174488.html), so 125 A set to 15. Dimensions 90x75 and 1.5 MU from https://www.eaton.com/es/es-es/skuPage.174480.resources.html (SKU 174480 search result). 3P+N=4 poles wide assumed. N side unknown.'))
def sd(series,page,pat,h,dep,src):
    L=lines(page)
    for i,l in enumerate(L):
        m=re.match(pat,l)
        if m and re.match(r'^\d{5,7}$',L[i+1]):
            cur=int(m.group('i')); s=m.group('s')
            poles={'1':'1P','2':'2P','3':'3P','4':'4P','3N':'4P'}[s]
            mod=int(poles[0])
            rows.append(dict(kind='switch_disconnector',manufacturer='Eaton',series=series,model=l,order_no=L[i+1],name=f'Rozłącznik izolacyjny {series} {cur} A {poles}'+(' (3+N)' if s=='3N' else ''),poles=poles,rated_current_a=cur,breaking_capacity_ka=None,characteristic=None,modules=mod,width_mm=mod*17.5,length_mm=None,height_mm=h,depth_mm=dep,n_terminal_side=None,terminal_groups=None,page=page,
              notes='No fuse links. Modules = poles (1 MU/pole; web SKU width 17.7/pole). '+('Catalog says 3+N; mapped to 4P. ' if s=='3N' else '')+src+' N side unknown.'))
sd('IS',118,r'^IS-(?P<i>\d+)/(?P<s>[1-4])$',80,60,'Height/depth from https://datasheet.eaton.com/datasheet.php?amp=&locale=en_GB&model=276275 (IS-63/2: 80 x 60 mm, built-in depth 69.5), applied to whole family.')
sd('HIS',119,r'^HIS-(?P<i>\d+)/(?P<s>[1-4])$',None,None,'Dimensions not verified.')
sd('ZP-A',120,r'^ZP-A(?P<i>\d+)/(?P<s>1|2|3N|3)$',None,None,'Dimensions not verified; 3 kA short-circuit with 40 A gG backup.')
def bb(series,model,no,ph,mod,cur,mm2,page,pitch=17.5,length='calc',notes=''):
    poles='1P' if ph==1 else '3P'
    Ln=mod*17.5 if length=='calc' else length
    rows.append(dict(kind='comb_busbar',manufacturer='Eaton',series=series,model=model,order_no=no,name=f'Szyna zasilająca {"1F" if ph==1 else "3F"} {series} {mm2} mm2',poles=poles,rated_current_a=cur,breaking_capacity_ka=None,characteristic=None,modules=mod,width_mm=(mod*17.5 if (pitch==17.5 and mod) else None),length_mm=Ln,height_mm=None,depth_mm=None,n_terminal_side=None,terminal_groups=None,page=page,cross_section_mm2=mm2,pin_pitch_mm=pitch,notes=notes))
for m,(t,no) in {2:('EVG-1PHAS/2MODUL','215646'),6:('EVG-1PHAS/6MODUL','215638'),12:('EVG-1PHAS/12MODUL','215637')}.items():
    bb('EVG',t,no,1,m,63,10,98,notes='Euro-Vario fork (widelkowa) busbar; length = modules x 17.5 (catalog gives MU only). Do not cut.')
for m,no in {2:'291464',6:'291465',12:'291466'}.items():
    bb('EVG',f'EVG-16/1PHAS/{m}MODUL',no,1,m,80,16,99,notes='Euro-Vario fork busbar; length = modules x 17.5. Do not cut.')
for m,(t,no) in {6:('EVGK-3PHAS/6MODUL','EP-501075'),9:('EVG-3PHAS/9MODUL','215645'),12:('EVGK-3PHAS/12MODUL','EP-501069'),16:('EVG-3PHAS/16MODUL','285381'),20:('EVG-3PHAS/20MODUL','285383')}.items():
    bb('EVG',t,no,3,m,63,10,98,notes='Euro-Vario fork busbar; length = modules x 17.5.'+(' Eaton SKU page lists 140 mm for 215645 (https://www.eaton.com/us/en-us/skuPage.215645.html).' if m==9 else ''))
for m,no in {6:'291470',9:'291471',12:'291472',16:'291473',20:'291474'}.items():
    bb('EVG',f'EVG-16/3PHAS/{m}MODUL',no,3,m,80,16,99,notes='Euro-Vario fork busbar; length = modules x 17.5.')
bb('Z-GV','Z-GV-16/1P-1MU/16','271074',1,16,80,16,101,notes='Delivered with end caps; 16 pins.')
for model,no,ph,cur,mm2,note in [('Z-GV-10/1P-1MU','270339',1,63,10,''),('GVK-10/3P-3TE','EP-501073',3,63,10,''),('Z-GV-10/3P-4MU','271080',3,63,10,'Catalog designation says 4MU for a 3-phase bar; probably the same 3-phase pattern (p102 lists Z-GV-10/3P-3TE).'),('Z-GV-16/1P-1MU','271061',1,80,16,''),('Z-GV-16/3P-3MU','271064',3,80,16,'')]:
    bb('Z-GV',model,no,ph,57,cur,mm2,101,length=1000,notes='1 m cut-to-length rail, no end caps; pins = floor(1000/17.5) = 57 (p102 shows 57 pins for 1P). '+note)
for model,no,ph,note in [('Z-SV-10/1P-1MU/13','264916',1,''),('Z-SV-10/1P-F/13','264918',1,'Angled (katowa) 1-phase variant.'),('Z-SV-10/3P-3TE/13','264924',3,'')]:
    bb('Z-SV',model,no,ph,13,50,10,105,notes='Comb busbar for FAZ-PN 1MU, supplied with end caps. '+note)
for model,no,ph,note in [('Z-SV-16/1P-1MU','264912',1,''),('Z-SV-16/1P-1MU/F','269523',1,'Angled variant.'),('Z-SV-16/3P-3TE','264925',3,'Web datasheet https://datasheet.eaton.com/datasheet.php?model=264925&locale=ru_RU: length 1000 mm, pitch 17.95 mm (not 17.5), 63 A.')]:
    bb('Z-SV',model,no,ph,57,63,16,105,length=1000,notes='1 m comb busbar, no end caps, 57 pins assumed. '+note)
for model,no,ph,cur,mm2 in [('Z-SV-16/3P','271072',3,80,16),('Z-SV-35/1P','113135',1,110,35),('Z-SV-35/3P','264938',3,110,35),('Z-SV-35/PLHT-V','264939',3,110,35)]:
    bb('Z-SV',model,no,ph,None,cur,mm2,104,pitch=27,length=None,notes='1.5 MU (27 mm) pitch for Z-SLS/AZ - does NOT fit 17.5 mm modelling; length not given. Rating per PDF (web shows 63 A for 271072).')
def bar(kind,series,model,no,tg,page,note=''):
    rows.append(dict(kind=kind,manufacturer='Eaton',series=series,model=model,order_no=no,name=('Szyna PE ' if kind=='pe_bar' else 'Szyna N ')+model,poles=None,rated_current_a=None,breaking_capacity_ka=None,characteristic=None,modules=None,width_mm=None,length_mm=None,height_mm=None,depth_mm=None,n_terminal_side=None,terminal_groups=tg,page=page,notes=note))
G=lambda l:[dict(count=c,minMm2=None,maxMm2=m) for c,m in l]
for m,no,l in [('KL-4','219723',[(1,25),(3,16)]),('KL-7','219724',[(1,25),(6,16)]),('KL-11','219725',[(2,25),(9,16)]),('KL-15','219726',[(2,25),(13,16)]),('KL-25','219727',[(2,25),(23,16)])]:
    bar('pe_bar','KL',m,no,G(l),262,'KLV-enclosure screw terminal block, usable as N or PE (blue N housing N-FI-KLV); min cross-section and width not stated; mounts on SK-KLV bracket.')
for m,no,c in [('BFZ-TS-KL11','293629',9),('BFZ-TS-KL15','293630',13),('BFZ-TS-KL29','293631',27),('BFZ-TS-KL45','293632',43),('BFZ-TS-KL60','293633',58),('BFZ-TS-KL76','293634',74)]:
    bar('pe_bar','BFZ-TS-KL',m,no,G([(2,25),(c,16)]),270,'N/PE terminal kit for BF enclosures with mounting parts; usable as N or PE.')
t=lambda c:[dict(count=c,minMm2=0.75,maxMm2=16)]
bar('n_bar','SK-KLV','SK-13N/PE-KLV','178906',t(13),262,'N half of combined bracket 13xN + 13xPE.')
bar('pe_bar','SK-KLV','SK-13N/PE-KLV','178906',t(13),262,'PE half of the same bracket (same order_no).')
bar('n_bar','SK-KLV','SK-13N/16PE-KLV','178907',t(13),262,'N half of combined bracket 13xN + 16xPE.')
bar('pe_bar','SK-KLV','SK-13N/16PE-KLV','178907',t(16),262,'PE half of same bracket.')
bar('n_bar','SK-KLV','SK-25N-KLV','178908',t(25),262)
bar('pe_bar','SK-KLV','SK-25PE-KLV','178909',t(25),262,'Catalog prints "(N)" on this PE row; treated as a typo.')
json.dump(rows,open(SP+'/extract/eaton-mcb-fr-bars.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
from collections import Counter
print(len(rows),Counter((r['kind'],r['series']) for r in rows))
