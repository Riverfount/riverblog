.PHONY: build serve

build:
	hugo --gc --minify

serve:
	hugo server -D
