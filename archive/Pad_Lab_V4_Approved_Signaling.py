#!/usr/bin/env python3
"""Optional same-origin, local-only signaling for Pad WebView Lab V4.
Use only on an approved test network. Defaults to localhost. No external requests,
proxying, chat relay or persistent storage. A room expires in five minutes.
"""
import argparse, json, secrets, time, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HTML = Path(__file__).with_name('Pad_WebView_Lab_V4.html')
rooms = {}
lock = threading.Lock()
TTL = 300

def description(d, kind):
    if not isinstance(d, dict) or d.get('type') != kind or not isinstance(d.get('sdp'), str) or not 1 <= len(d['sdp']) <= 50000:
        raise ValueError('无效的连接描述')
    return {'type': kind, 'sdp': d['sdp']}

def action(name, data):
    if name == 'health': return {'service':'pad-lab-v4'}
    with lock:
        now = time.monotonic()
        for c in list(rooms):
            if rooms[c]['expires'] <= now: del rooms[c]
        if name == 'create':
            if len(rooms) >= 64: raise ValueError('测试房间已满')
            offer = description(data.get('offer'), 'offer')
            code = f'{secrets.randbelow(1000000):06d}'
            while code in rooms: code = f'{secrets.randbelow(1000000):06d}'
            token = secrets.token_urlsafe(24)
            rooms[code] = {'offer':offer,'owner':token,'guest':None,'answer':None,'expires':now+TTL}
            return {'code':code,'token':token}
        code = data.get('code')
        if not isinstance(code, str) or code not in rooms: raise ValueError('房间不存在或已过期')
        r = rooms[code]
        if name == 'join':
            if r['guest'] is not None: raise ValueError('房间已有人加入，请重新创建')
            r['guest'] = secrets.token_urlsafe(24)
            return {'offer':r['offer'],'token':r['guest']}
        if name == 'answer':
            if not r['guest'] or data.get('token') != r['guest']: raise ValueError('应答凭据不正确')
            if r['answer'] is not None: raise ValueError('已经提交应答')
            r['answer'] = description(data.get('answer'),'answer')
            return {}
        if name == 'poll':
            if data.get('token') != r['owner']: raise ValueError('房间凭据不正确')
            return {'answer':r['answer']}
        raise ValueError('不支持的操作')

class Handler(BaseHTTPRequestHandler):
    def response(self, code, content, kind):
        self.send_response(code); self.send_header('Content-Type',kind)
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(content))); self.end_headers(); self.wfile.write(content)
    def do_GET(self):
        if urlsplit(self.path).path != '/pad-lab/': return self.response(404,b'Not found','text/plain')
        self.response(200,HTML.read_bytes(),'text/html; charset=utf-8')
    def do_POST(self):
        path=urlsplit(self.path).path
        prefix='/pad-lab/api/'
        try:
            if not path.startswith(prefix): raise ValueError('无效接口')
            if self.headers.get('Origin') not in (None,'http://'+self.headers.get('Host','')): raise ValueError('仅允许同源请求')
            if self.headers.get('Content-Type','').split(';')[0] != 'application/json': raise ValueError('无效内容类型')
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=65536: raise ValueError('请求长度不正确')
            data=json.loads(self.rfile.read(n));
            if not isinstance(data,dict): raise ValueError('无效请求')
            result={'ok':True,**action(path[len(prefix):],data)}; status=200
        except (ValueError,TypeError,KeyError) as e:
            result={'ok':False,'error':str(e)};status=400
        self.response(status,json.dumps(result,ensure_ascii=False).encode(),'application/json; charset=utf-8')
    def log_message(self,*args): pass

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',default='127.0.0.1',help='Approved interface address; default local machine only')
    parser.add_argument('--port',type=int,default=8765)
    args=parser.parse_args()
    if not HTML.is_file(): raise SystemExit('Place the HTML file next to this script.')
    print(f'Pad Lab: http://{args.host}:{args.port}/pad-lab/ (authorized test network only)',flush=True)
    ThreadingHTTPServer((args.host,args.port),Handler).serve_forever()
