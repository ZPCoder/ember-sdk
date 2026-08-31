# @zpcoder/ember-sdk

Authoritative, deterministic TypeScript rules shared by the Cocos client, local AI, React reference client, and server replay. The package emits ESM JavaScript and declarations; consumers never load raw `.ts` files.

Platform access is dependency-injected through `Clock`, `SecureRng`, `Storage`, and `Network`. Formal PVP state remains server-authoritative; the client SDK only transports commands and stores short-lived sessions.

All production rule and adapter sources are strict-checked before emit. The large
legacy test fixture is compiled in a separate, non-published pass so historical
fixture typing cannot weaken the package build. The 235 deterministic rule
tests plus SDK replay tests remain release gates.

```sh
npm ci
npm test
npm run pack:check
```

Releases use Changesets CLI `2.29.8` and publish the restricted `@zpcoder/ember-sdk` package to GitHub Packages from the protected `main` workflow. Local verification must use `pack:check`; it never writes to a registry.
