#!/bin/bash
# 双击启动读论文插件的本机服务。要用对照翻译，把下面两行前面的 # 去掉并填上自己的接口和密钥。
# export RN_TRANSLATE_API_BASE="https://api.siliconflow.cn/v1"
# export RN_TRANSLATE_API_KEY="你的密钥"
# export RN_ASK_PERSONA="我是心理学研一学生，英文一般"
cd "$(dirname "$0")" && python3 server.py
