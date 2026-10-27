# dxflrs/garage ships as a distroless-style image with just the /garage binary
# (no shell), so we can't run a bootstrap entrypoint script inside it directly.
# This repackages the same binary onto a minimal shell-having base so the
# single-node bootstrap in garage-entrypoint.sh can run.
FROM dxflrs/garage:v2.0.0 AS garage

FROM busybox:1.36-musl
COPY --from=garage /garage /garage
COPY garage-entrypoint.sh /garage-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/garage-entrypoint.sh"]
