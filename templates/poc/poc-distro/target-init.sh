#!/bin/sh
set -e

# 前台或后台启动服务。就绪后打印一行 "<service> ready on <port>"，
# run.sh 靠这一行判断容器已可用。
<start the service>

echo "<service> ready on <port>"
exec sleep infinity
