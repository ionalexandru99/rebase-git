export const MODIFY_PATCH = `diff --git a/simple.txt b/simple.txt
index a92d664..80a6513 100644
--- a/simple.txt
+++ b/simple.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 EDITED
 line 3
`

export const MULTI_HUNK_PATCH = `diff --git a/multi.txt b/multi.txt
index bab081f..5fd74b9 100644
--- a/multi.txt
+++ b/multi.txt
@@ -1,4 +1,4 @@
-line 1
+line 1 EDITED
 line 2
 line 3
 line 4
@@ -33,7 +33,7 @@ line 32
 line 33
 line 34
 line 35
-line 36
+line 36 EDITED
 line 37
 line 38
 line 39
`

export const UNTRACKED_PATCH = `diff --git a/untracked.txt b/untracked.txt
new file mode 100644
index 0000000..fbbee86
--- /dev/null
+++ b/untracked.txt
@@ -0,0 +1,2 @@
+alpha
+beta
`

export const RENAME_WITH_EDIT_PATCH = `diff --git a/renamed-src.txt b/renamed-dst.txt
similarity index 66%
rename from renamed-src.txt
rename to renamed-dst.txt
index de98044..7be73ce 100644
--- a/renamed-src.txt
+++ b/renamed-dst.txt
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`

export const PURE_RENAME_PATCH = `diff --git a/renamed-dst.txt b/renamed-final.txt
similarity index 100%
rename from renamed-dst.txt
rename to renamed-final.txt
`

export const DELETE_PATCH = `diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
index 286c5f5..0000000
--- a/deleted.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
`

export const NO_TRAILING_NEWLINE_PATCH = `diff --git a/noeol.txt b/noeol.txt
index 1045c4a..0ba6e66 100644
--- a/noeol.txt
+++ b/noeol.txt
@@ -1 +1 @@
-no newline here
\\ No newline at end of file
+no newline changed
\\ No newline at end of file
`

export const CRLF_PATCH =
  'diff --git a/crlf.txt b/crlf.txt\n' +
  'index 04ec35a..20a747d 100644\n' +
  '--- a/crlf.txt\n' +
  '+++ b/crlf.txt\n' +
  '@@ -1,3 +1,3 @@\n' +
  ' x\r\n' +
  '-y\r\n' +
  '+Y\r\n' +
  ' z\r\n'

export const PATCH_LOOKALIKE_CONTENT_PATCH = `diff --git a/tricky.txt b/tricky.txt
index 78f07e5..6022fa0 100644
--- a/tricky.txt
+++ b/tricky.txt
@@ -1,3 +1,3 @@
 diff --git a/fake b/fake
 @@ fake hunk @@
-real content
+real content EDITED
`

export const BINARY_PATCH = `diff --git a/blob.bin b/blob.bin
index eaf36c1..52b403a 100644
Binary files a/blob.bin and b/blob.bin differ
`

export const CONFLICT_OURS_PATCH = `* Unmerged path conflict.txt
diff --git a/conflict.txt b/conflict.txt
index ba2906d..58487cf 100644
--- a/conflict.txt
+++ b/conflict.txt
@@ -1 +1,5 @@
+<<<<<<< HEAD
 main
+=======
+side
+>>>>>>> side
`

export const COMBINED_DIFF_PATCH = `diff --cc conflict.txt
index ba2906d,2299c37..0000000
--- a/conflict.txt
+++ b/conflict.txt
@@@ -1,1 -1,1 +1,5 @@@
++<<<<<<< HEAD
 +main
++=======
+ side
++>>>>>>> side
`
