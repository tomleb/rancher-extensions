IMAGE := rancher-extensions-dev
PORT  := 8005

.PHONY: dev
dev:
ifndef API
	$(error API is required, e.g. `make dev API=https://your-rancher-host`)
endif
	docker build -f Dockerfile.dev -t $(IMAGE) .
	docker run --rm -it \
		-p $(PORT):$(PORT) \
		-v $(CURDIR):/work \
		-w /work \
		-e API=$(API) \
		-e HOME=/tmp \
		--user $(shell id -u):$(shell id -g) \
		$(IMAGE)
