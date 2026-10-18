FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY downloads /usr/share/nginx/html/downloads
COPY index.html styles.css main.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
EXPOSE 8080
