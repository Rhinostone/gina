# Closure Compiler

The Google Closure Compiler JAR files are not stored in this repository.

## Requirements

- `curl`
- `java` >= 21 (to run the compiler during builds — v20260422 JAR has
  bytecode major version 65, which is Java 21)

Run the install script once before building:

    bash install-closure-compiler.sh

Depending on where Gina was installed or cloned, you may need `sudo`:

    sudo bash install-closure-compiler.sh

This is typically required when installed under a system-wide prefix such as
`/usr/local`, and not needed for user-local installs like `~/.npm-global`.

This downloads the following JAR from Maven Central and creates the
`compiler.jar` symlink used by the `build` script:

- `closure-compiler-v20260422.jar` ← active (`compiler.jar` → this) — requires Java 21+
