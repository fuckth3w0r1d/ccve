FROM <distro>:<release>

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends <pkg> python3 \
 && apt-get clean \
 && find /var/lib/apt/lists -mindepth 1 -delete

COPY target-init.sh /usr/local/bin/target-init.sh
RUN chmod +x /usr/local/bin/target-init.sh

EXPOSE <port>
CMD ["/usr/local/bin/target-init.sh"]
