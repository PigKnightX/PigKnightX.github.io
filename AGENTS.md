# Project instructions

## Scope

This repository is a Jekyll blog built with the Chirpy theme. Site content lives in `_posts/` and `_tabs/`; site settings live in `_config.yml`; reusable templates and styles live in `_includes/`, `_layouts/`, and `_sass/`.

## Content conventions

- Give every post YAML front matter with `title`, `date`, `categories`, `tags`, and `author`.
- Keep tag names lowercase and use the existing `pigknightx` author entry unless a new author is intentionally added.
- Write Chinese or bilingual content consistently with the site's `zh-CN` locale.
- Keep `_site/` generated; edit source files instead of generated output.

## Validation

Run these checks after changes:

```bash
bundle exec jekyll build
npm test
bundle exec htmlproofer _site --disable-external --ignore-urls '/^http:\/\/127.0.0.1/,/^http:\/\/0.0.0.0/,/^http:\/\/localhost/'
```

The GitHub Pages workflow deploys pushes to `master` or `main`; the repository currently uses `master`.

## Completion

A change is ready when the relevant source files are updated, generated output builds successfully, and the applicable checks above pass. Report any environment-only check that cannot run instead of silently skipping it.
