FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive

RUN sed -i 's|http://archive.ubuntu.com|http://mirrors.aliyun.com|g; s|http://security.ubuntu.com|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/ubuntu.sources \
 && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates build-essential gcc g++ clang make cmake pkg-config \
      gdb binutils file vim less git curl wget \
      python3 python3-pip python3-venv \
      socat netcat-openbsd tcpdump strace ltrace procps \
      qemu-user \
      checksec patchelf \
      libc6-dbg \
    && apt-get clean \
    && find /var/lib/apt/lists -mindepth 1 -delete

RUN pip3 install --break-system-packages --no-cache-dir \
      --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      pwntools capstone ROPgadget

RUN git clone --depth 1 https://github.com/pwndbg/pwndbg /opt/pwndbg \
 && cd /opt/pwndbg \
 && ./setup.sh

COPY gdbinit /etc/gdb/gdbinit.d/ccve
RUN mkdir -p /etc/gdb/gdbinit.d && chmod 644 /etc/gdb/gdbinit.d/ccve

WORKDIR /

CMD ["sleep", "infinity"]
