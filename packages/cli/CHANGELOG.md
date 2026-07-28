# scholia

## 0.1.1

### Patch Changes

- [#51](https://github.com/jtmthf/scholia/pull/51) [`f66c538`](https://github.com/jtmthf/scholia/commit/f66c538965fc1a1e387bf1bda4b72aa9829abac1) Thanks [@jtmthf](https://github.com/jtmthf)! - Fix Local Preview's main content column collapsing into the Outline's narrow track whenever Nav is shown — the mobile nav's backdrop `<div>` had no default `display: none`, so it became an implicit CSS Grid item at desktop widths and stole the content column, squeezing the article into ~220px. Also give Nav a subtitle when sibling Pages share an identical title (e.g. several root docs each opening with `# Scholia`), so they're no longer indistinguishable in the sidebar.

- [#47](https://github.com/jtmthf/scholia/pull/47) [`9bbe631`](https://github.com/jtmthf/scholia/commit/9bbe6312caddff30cfd2e7c53585336805df293c) Thanks [@jtmthf](https://github.com/jtmthf)! - Configure automated releases. Adds Changesets (versioning, changelog, CI
  changeset gate) and an npm trusted-publishing release workflow (OIDC, no
  long-lived token). No CLI behaviour change.
