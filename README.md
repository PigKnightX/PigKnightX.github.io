# LEI's Blog

这是 LEI 的个人技术博客，使用 [Jekyll](https://jekyllrb.com/) 和 [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) 构建，记录 JavaScript、前端开发、读书笔记和日常思考。

## 本地运行

需要 Ruby、Bundler 和 Node.js：

```bash
bundle install
npm install
bundle exec jekyll serve
```

访问 <http://127.0.0.1:4000> 查看站点。

## 常用检查

```bash
bundle exec jekyll build
npm test
bundle exec htmlproofer _site --disable-external
```

文章放在 `_posts/`，站点导航页放在 `_tabs/`。提交到 `master` 或 `main` 分支后，GitHub Actions 会构建并发布 GitHub Pages。
