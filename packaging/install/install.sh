#!/bin/sh
set -eu

releases="${REBASE_RELEASE_BASE_URL:-https://github.com/ionalexandru99/rebase-git/releases}"
versions="$HOME/.rebase/runtime/versions"
bin_dir="$HOME/.local/bin"

fail() {
  printf 'rebase install: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) platform=linux ;;
  Darwin) platform=darwin ;;
  *) fail "unsupported operating system $(uname -s). Use install.ps1 on Windows." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported architecture $(uname -m)." ;;
esac
if [ "$platform" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = 1 ]; then
  arch=arm64
fi
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."

version="${REBASE_VERSION:-}"
if [ -z "$version" ]; then
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$releases/latest")" ||
    fail "could not find the latest release."
  version="${latest##*/tag/v}"
  [ "$version" != "$latest" ] || fail "could not find the latest release."
fi
version="${version#v}"

archive="rebase-$version-$platform-$arch.tar.gz"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
trap 'exit 130' INT TERM

printf 'Downloading Rebase %s for %s %s...\n' "$version" "$platform" "$arch"
curl -fsSL -o "$temporary/$archive" "$releases/download/v$version/$archive" ||
  fail "could not download $archive."
curl -fsSL -o "$temporary/SHA256SUMS" "$releases/download/v$version/SHA256SUMS" ||
  fail "could not download SHA256SUMS."

expected="$(awk -v file="$archive" '$2 == file || $2 == "*" file { print $1 }' "$temporary/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS has no $archive."
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary/$archive" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$temporary/$archive" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || fail "the checksum of $archive does not match SHA256SUMS."

mkdir -p "$versions" "$bin_dir"
staging="$(mktemp -d "$versions/.$version.XXXXXX")"
tar -xzf "$temporary/$archive" -C "$staging" || {
  rm -rf "$staging"
  fail "could not extract $archive."
}
rm -rf "$versions/$version"
mv "$staging" "$versions/$version"

launcher="$versions/$version/bin/rebase"
escaped="$(printf '%s' "$launcher" | sed "s/'/'\\\\''/g")"
printf "#!/bin/sh\nexec '%s' \"\$@\"\n" "$escaped" > "$bin_dir/.rebase.$$"
chmod 755 "$bin_dir/.rebase.$$"
mv "$bin_dir/.rebase.$$" "$bin_dir/rebase"

"$bin_dir/rebase" --version >/dev/null || fail "the installed rebase command does not run."
printf 'Installed Rebase %s. Run rebase to open it.\n' "$version"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf '\nAdd %s to your PATH to run rebase:\n  export PATH="%s:$PATH"\n' "$bin_dir" "$bin_dir" ;;
esac
