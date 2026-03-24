"""9:30（北京时间）给全员发钉钉工作通知，提醒注册米伽米工单管理系统。"""

import json, time, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

APP_KEY = "dinghgulv1lkus6g70rv"
APP_SECRET = "9BUeL6ky1panP2H-1HTl0H5PunyaSoOsyBqdiU5x8DeRbRUJibnS7VSUergnASBQ"
AGENT_ID = "4387554027"
APP_URL = "https://issue-tracker-nu-sandy.vercel.app"

USERS = [
    "0113566156491177224",   # 郝毅
    "1938652254845431",      # 方锐
    "01064659504226268137",  # 李梦威
    "224464334126278491",    # 李梦艳
]

CST = timezone(timedelta(hours=8))
target = datetime(2026, 3, 25, 9, 30, 0, tzinfo=CST)
now = datetime.now(CST)
wait = (target - now).total_seconds()

if wait > 0:
    h, m = int(wait // 3600), int((wait % 3600) // 60)
    print(f"当前北京时间 {now.strftime('%H:%M:%S')}，等待 {h} 小时 {m} 分钟到 09:30…")
    time.sleep(wait)
else:
    print(f"已过 09:30，立即发送")

print("获取 access_token…")
url = f"https://oapi.dingtalk.com/gettoken?appkey={APP_KEY}&appsecret={APP_SECRET}"
resp = json.loads(urllib.request.urlopen(url).read())
token = resp["access_token"]

msg = {
    "msgtype": "markdown",
    "markdown": {
        "title": "请注册米伽米工单管理系统",
        "text": "\n".join([
            "## 请注册米伽米工单管理系统",
            "",
            "各位同事好！",
            "",
            "我们启用了米伽米工单管理系统，用于管理日常工单与协同催办。**请在今天完成注册**，之后你会通过钉钉收到工单指派和进度提醒。",
            "",
            f"### [点击这里注册]({APP_URL}/login)",
            "",
            "**请用电脑浏览器打开以上链接**",
            "",
            "- 注册时**姓名请填写真实姓名**，方便系统匹配",
            "- 注册完成后即可查看和更新问题",
            "",
            "如有疑问请联系郝毅。",
        ]),
    },
}

data = urllib.parse.urlencode({
    "agent_id": AGENT_ID,
    "userid_list": ",".join(USERS),
    "msg": json.dumps(msg),
}).encode()

send_url = f"https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token={token}"
req = urllib.request.Request(send_url, data=data, headers={
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
})
result = json.loads(urllib.request.urlopen(req).read())
print(f"发送结果: {json.dumps(result, ensure_ascii=False)}")

if result.get("errcode") == 0:
    print(f"✅ 已向 {len(USERS)} 人发送注册提醒！")
else:
    print(f"❌ 发送失败: {result.get('errmsg')}")
