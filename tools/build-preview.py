# index.html 을 파일 하나로 묶어 아티팩트로 올릴 수 있게 만든다.
#
#   1) 먼저 자산을 줄여 데이터 URI 로 바꿔 /tmp/assets.json 에 담아 두고
#   2) Tailwind 를 이 페이지가 쓰는 클래스만 추려 /tmp/twbuild/out.css 로 뽑은 뒤
#   3) 이 스크립트로 dnotitia-recruit-preview.html 을 만든다
#
# 아티팩트 화면은 바깥 호스트를 막기 때문에 CDN·이미지·유튜브 섬네일이 모두 안 나온다.
# 그래서 Tailwind 와 그림은 페이지 안에 넣고, 유튜브 자리는 대신할 그림을 그려 넣는다.

import json, re, os
src = open('/home/user/page/index.html', encoding='utf-8').read()
tw  = open('/tmp/twbuild/out.css', encoding='utf-8').read()
assets = json.load(open('/tmp/assets.json'))
for pat in [r'<!DOCTYPE html>\s*', r'<html lang="ko">\s*', r'</html>\s*',
            r'<head>\s*', r'</head>\s*',
            r'<meta charset="UTF-8">\s*', r'<meta name="viewport"[^>]*>\s*',
            r'<link rel="icon"[^>]*>\s*', r'<link rel="apple-touch-icon"[^>]*>\s*',
            r'<link href="https://fonts\.googleapis\.com/css2\?family=Pretendard[^>]*>\s*',
            r'<!-- 주소창 위 탭에 표시되는 문구 -->\s*',
            r'<!-- ✨ 브라우저 탭 아이콘을[^>]*-->\s*',
            r'<!-- Tailwind CSS 표준 로드 -->\s*',
            r'<body class="selection:bg-orange-500/30">\s*', r'</body>\s*']:
    src = re.sub(pat, '', src, count=1)
src = src.replace('<script src="https://cdn.tailwindcss.com"></script>',
                  '<style>/* Tailwind — 이 페이지에서 실제로 쓰는 클래스만 추려 넣음 */\n' + tw + '</style>\n'
                  '<style>::selection{background:rgba(249,115,22,.32)}</style>', 1)
miss = [n for n in assets if f'"{n}"' not in src]
for name, a in assets.items():
    src = src.replace(f'"{name}"', f'"{a["uri"]}"')
ph = ('data:image/svg+xml;utf8,' +
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'>"
  "<defs><linearGradient id='g' x1='0' y1='0' x2='0.7' y2='1'>"
  "<stop offset='0' stop-color='%23132a44'/><stop offset='1' stop-color='%23081422'/></linearGradient></defs>"
  "<rect width='1280' height='720' fill='url(%23g)'/>"
  "<text x='640' y='372' text-anchor='middle' fill='%236b8099' "
  "font-family='sans-serif' font-size='34'>영상은 원본 사이트에서 재생됩니다</text></svg>")
src = re.sub(r'src="https://i\.ytimg\.com/[^"]*"', f'src="{ph}"', src)
src = re.sub(r'onerror="[^"]*ytimg[^"]*"', '', src)
open('/home/user/page/dnotitia-recruit-preview.html','w',encoding='utf-8').write(src)
print('참조 못 찾은 자산:', miss or '없음')
print('크기', round(os.path.getsize('/home/user/page/dnotitia-recruit-preview.html')/1024/1024,2),'MB')
print('vector-field 포함:', 'vector-field' in src)
