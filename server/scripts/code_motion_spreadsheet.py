"""受限 XLSX 数据读取：标准库，不计算公式，不加载外部关系。"""
import sys, json, io, zipfile, re, posixpath, datetime
import xml.etree.ElementTree as ET

MAX_ROWS, MAX_COLS = 201, 24
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PACKAGE_REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'

def read_workbook(raw):
    if len(raw) > 8*1024*1024:
        raise ValueError('文件超过8MB，已停止导入')
    archive = zipfile.ZipFile(io.BytesIO(raw))
    infos = archive.infolist()
    names = [item.filename for item in infos]
    if len(names) > 256 or len(set(names)) != len(names):
        raise ValueError('工作簿文件过多或存在重复条目，请另存所需工作表')
    if any(re.search(r'vbaProject|externalLinks|macrosheets|embeddings', n, re.I) for n in names):
        raise ValueError('工作簿含宏、外部链接或嵌入对象，请另存纯数据XLSX后导入')
    total_bytes = 0
    def xml(name, optional=False):
        nonlocal total_bytes
        if name not in names:
            if optional: return None
            raise ValueError('工作簿缺少必要文件：'+name)
        info = archive.getinfo(name)
        if info.flag_bits & 1 or info.file_size > 8*1024*1024:
            raise ValueError('工作簿文件加密或解压容量过大，已停止导入')
        with archive.open(name) as f:
            data = f.read(8*1024*1024+1)
        total_bytes += len(data)
        if len(data)>8*1024*1024 or total_bytes>20*1024*1024:
            raise ValueError('工作簿解压超过20MB，已停止导入，请另存所需工作表')
        # OOXML可为UTF8或UTF16；解码后检查，避免宽字符绕过实体门禁。
        encoding = 'utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
        text = data.decode(encoding)
        if re.search(r'<!DOCTYPE|<!ENTITY', text, re.I):
            raise ValueError('工作簿XML含不支持的实体声明')
        root = ET.fromstring(text)
        stack = [(root, 0)]; nodes = 0
        while stack:
            elem, depth = stack.pop(); nodes += 1
            if nodes>50000 or depth>64: raise ValueError('工作簿XML层级或节点过多，已停止导入')
            stack.extend((child, depth+1) for child in elem)
        return root
    relationships = {}
    for name in names:
        if not name.endswith('.rels'): continue
        root = xml(name)
        for rel in root.findall(PACKAGE_REL+'Relationship'):
            if rel.get('TargetMode', '').lower() == 'external':
                raise ValueError('工作簿含外部链接，请另存纯数据后导入')
            if name == 'xl/_rels/workbook.xml.rels':
                target = rel.get('Target', '')
                relationships[rel.get('Id')] = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/'+target)
    root = xml('xl/workbook.xml')
    if root.tag != NS+'workbook': raise ValueError('XLSX工作簿命名空间或类型不受支持')
    prop = root.find(NS+'workbookPr'); uses1904 = prop is not None and prop.get('date1904') in ('1','true')
    shared = xml('xl/sharedStrings.xml', True)
    strings = [''.join(t.text or '' for t in si.iter(NS+'t')) for si in shared.findall(NS+'si')] if shared is not None else []
    if len(strings)>20000: raise ValueError('共享文字超过2万项，请缩小范围')
    style = xml('xl/styles.xml', True); formats=[]; custom={}
    if style is not None:
        nums=style.find(NS+'numFmts'); xfs=style.find(NS+'cellXfs')
        custom={int(n.get('numFmtId')): n.get('formatCode','') for n in nums} if nums is not None else {}
        formats=[int(n.get('numFmtId','0')) for n in xfs] if xfs is not None else []
    warnings=['显示单元格原值，不保留Excel版式；日期、百分比、单位请对照原表核对，系统不会自动换算。']
    def warn(message):
        if message not in warnings: warnings.append(message)
    sheets=[]; total_cells=0; total_chars=0
    sheet_nodes=root.find(NS+'sheets')
    if sheet_nodes is None or len(sheet_nodes)>10: raise ValueError('工作簿无工作表或超过10张，请另存所需表')
    for sheet in sheet_nodes:
        name=sheet.get('name','工作表'); target=relationships.get(sheet.get(REL+'id'),'')
        if not re.fullmatch(r'xl/worksheets/[^/]+\.xml',target): raise ValueError('工作表关系无效或类型不受支持')
        data=xml(target)
        if data.tag != NS+'worksheet': raise ValueError('工作表命名空间不受支持')
        cells={}; max_row=0; max_col=0
        for row in data.findall(NS+'sheetData/'+NS+'row'):
            for c in row.findall(NS+'c'):
                ref=c.get('r',''); m=re.fullmatch(r'([A-Z]+)([1-9]\d*)',ref)
                if not m: raise ValueError('单元格位置缺失，已停止导入')
                rn=int(m.group(2)); cn=0
                for ch in m.group(1): cn=cn*26+ord(ch)-64
                if rn>MAX_ROWS or cn>MAX_COLS: raise ValueError(f'工作表“{name}”在{ref}超出201行或24列，已停止导入，请另存所需范围')
                total_cells+=1
                if total_cells>20000: raise ValueError('工作簿超过2万个单元格，已停止导入')
                if (rn,cn) in cells: raise ValueError('单元格位置重复，已停止导入')
                typ=c.get('t','n')
                if typ not in ('n','s','inlineStr','e','d','str','b'): raise ValueError('不支持的单元格类型，已停止导入')
                v=c.find(NS+'v'); raw_value=v.text or '' if v is not None else ''; formula=c.find(NS+'f') is not None
                cell={'text':'','kind':'blank'}
                if formula and not raw_value:
                    cell={'text':'公式缺少缓存结果','kind':'error'}
                    warn('部分公式没有缓存结果，不能用于数值列；请用Excel计算并保存后重传。')
                elif typ=='s':
                    if not re.fullmatch(r'\d+',raw_value) or int(raw_value)>=len(strings): raise ValueError('共享文字索引无效')
                    cell={'text':strings[int(raw_value)],'kind':'text'}
                elif typ=='inlineStr': cell={'text':''.join(t.text or '' for t in c.iter(NS+'t')),'kind':'text'}
                elif typ=='e': cell={'text':raw_value or '单元格错误','kind':'error'}
                elif typ=='d': cell={'text':raw_value,'kind':'date'}
                elif typ=='str': cell={'text':raw_value,'kind':'text'}
                elif typ=='b': cell={'text':'TRUE' if raw_value=='1' else 'FALSE','kind':'text'}
                elif raw_value:
                    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?',raw_value): raise ValueError('单元格数值无效')
                    number=float(raw_value)
                    import math
                    if not math.isfinite(number): raise ValueError('单元格数值无效')
                    style_id=int(c.get('s','0'))
                    if style_id and style_id>=len(formats): raise ValueError('单元格格式索引无效')
                    fmt=formats[style_id] if formats else 0; code=custom.get(fmt,'')
                    datefmt=(14<=fmt<=22 or 45<=fmt<=47 or re.search(r'[ymdhis]',re.sub(r'"[^"]*"|\[[^\]]*\]|\\.','',code),re.I))
                    if datefmt:
                        if not uses1904 and number==60: display='1900-02-29（Excel日期）'
                        else:
                            base=datetime.datetime(1904,1,1) if uses1904 else datetime.datetime(1899,12,30)
                            display=(base+datetime.timedelta(days=number+(1 if not uses1904 and number<60 else 0))).isoformat(sep=' ')
                        cell={'text':display,'kind':'date'}
                        warn('日期已按工作簿日期系统显示；日期只能用于名称列，不推算时间间隔。')
                    else: cell={'text':raw_value,'kind':'number','value':number}
                    if fmt in (9,10) or '%' in code: warn('含百分比格式：使用原始小数（如0.15），不自动乘100；请明确图表单位。')
                if formula:
                    cell['formulaCached']=bool(raw_value)
                    warn('公式使用文件内缓存结果，可能过期；系统未执行或重算公式，请核对后采用。')
                if len(cell['text'])>2000: raise ValueError('单元格超过2000字，已停止导入')
                total_chars+=len(cell['text'])
                if total_chars>200000: raise ValueError('工作簿文字超过20万字，已停止导入')
                cells[(rn,cn)]=cell;max_row=max(max_row,rn);max_col=max(max_col,cn)
        sheets.append({'name':name,'hidden':sheet.get('state') in ('hidden','veryHidden'),'rows':[{'index':r,'cells':[cells.get((r,c),{'text':'','kind':'blank'}) for c in range(1,max_col+1)]} for r in range(1,max_row+1)]})
    if not sheets: raise ValueError('没有可读取的工作表')
    return {'sheets':sheets,'warnings':warnings}

try:
    result=read_workbook(sys.stdin.buffer.read(8*1024*1024+1))
    print(json.dumps({'ok':True,'workbook':result},ensure_ascii=False,allow_nan=False))
except Exception as error:
    message=str(error) if isinstance(error,ValueError) else 'XLSX结构损坏或不受支持，请另存纯数据后重试'
    print(json.dumps({'ok':False,'error':message},ensure_ascii=False))
