FROM ubuntu:24.04 AS toolchain
ARG NODE_VERSION=26.12.0
ARG BUN_VERSION=1.3.11
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip xz-utils python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN arch="$(dpkg --print-architecture | sed 's/amd64/x64/')" \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" | tar -xJ -C /usr/local --strip-components=1 \
  && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}"

FROM ubuntu:24.04 AS host
ENV container=docker
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session openssh-server sudo curl ca-certificates tar coreutils git \
  && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash dev \
  && echo 'dev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dev \
  && install -d -m 700 -o dev -g dev /home/dev/.ssh \
  && printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/e2e.conf \
  && systemctl enable ssh.socket
COPY acp-stub.cjs /opt/telar-e2e/acp-stub.cjs
RUN printf '#!/bin/sh\nexec env TELAR_RUN_SCRIPT=/opt/telar-e2e/acp-stub.cjs "$HOME/.local/bin/telar" "$@"\n' > /usr/local/bin/telar-e2e-agent \
  && chmod 755 /usr/local/bin/telar-e2e-agent
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
