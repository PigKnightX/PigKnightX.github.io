# Project instructions

## Scope

This repository is a Jekyll blog built with the Chirpy theme. Site content lives in `_posts/` and `_tabs/`; site settings live in `_config.yml`; reusable templates and styles live in `_includes/`, `_layouts/`, and `_sass/`.

## Content conventions

- Give every post YAML front matter with `title`, `date`, `categories`, `tags`, and `author`.
- Keep tag names lowercase and use the existing `pigknightx` author entry unless a new author is intentionally added.
- Write Chinese or bilingual content consistently with the site's `zh-CN` locale.
- Keep `_site/` generated; edit source files instead of generated output.

## Writing style: avoid AI-flavored prose

Posts are technical essays in the author's voice, not assistant output. When drafting or editing content in `_posts/` and `_tabs/`, apply these rules — each targets a pattern that makes prose read as machine-generated:

- Every sentence must carry subject information. If deleting a sentence loses nothing, delete it.
- Never manage the reader's reading ("先记住这几份文件，不用急着通读", "读到这里"). Give the real reason the material matters instead: "这几份文件后面会反复用到，现在扫一眼文件名就行".
- No translated-English scaffolding: "答案藏在……里", "让我们", "值得注意的是", "综上所述", "总而言之".
- Never invent a wrong assumption just to refute it. The "不是 A，而是 B" pattern (and its cousin: posing a rhetorical question "难道 A？" then answering "不是 A") presumes the reader believed A, when the reader never said so — it's straw-man refuting that reads as padding. Lead with the fact instead. Two legitimate exceptions: (1) negating a misconception the reader plausibly holds and the post acknowledges, e.g. "即使文章一字未改，重新部署也可能触发更新提示"; (2) assert-then-boundary, where a positive claim is followed by its actual limit, e.g. "记录的是构建时间，不是文章内容的哈希" — both halves carry information, and the boundary corrects a real ambiguity.
- Do not end a section or the post by recapping what was just said ("一个小弹窗，串起了完整的过程"). End on the sharpest fact, or resolve the opening question.
- Skip cutesy personification ("请求途中的小管家", "三位主角") unless the post deliberately commits to that voice throughout.
- Drop filler qualifiers like "熟悉的" / "常见的" unless they point to something concrete (e.g. the opening anecdote).
- Make cross-references precise: "见文末问题四", not "在文末问答中展开".
- Refer back to earlier explanations instead of restating them in near-identical words.
- Verify Chinese collocations (量词 and fixed pairs): e.g. "一枚按钮" → "一个按钮".
- Use bold only for load-bearing claims, not decoration.

Self-check before finalizing: scan the draft for sentences that would survive deletion with zero information loss, and rewrite or remove them.

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
