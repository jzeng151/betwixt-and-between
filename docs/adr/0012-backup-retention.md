# Daily recoverable backups and image retention

Status: accepted, September 2026.

The application database contains references to uploaded map images in R2. A database dump alone cannot restore those images. Duplicated maps share image files, and historical database backups can need files no longer referenced by the live application.

Use daily compressed PostgreSQL custom-format dumps and content-addressed image copies on Backblaze B2. Reuse rclone's crypt backend to encrypt and decrypt both data types. Publish a manifest only after downloading and restoring the stored database archive and verifying every referenced image. The manifest maps original upload filenames to content hashes. Keep 30 days of complete backups and one per calendar month for 12 months. An image remains while any retained manifest references it.

Production backup and cleanup activation are separate repository variables. Cleanup defaults to reporting candidates. Backups must succeed before retention or source cleanup can run. Source cleanup rechecks live references under table locks, preserves duplicated-map and note references, and only considers recognized upload filenames observed as unreferenced for over seven days. The locks trade brief write blocking for a simple initial implementation; tracked asset references are the upgrade path if scale makes that unacceptable.

This replaces the unconfigured GPG-only weekly workflow. The crypt configuration contains the recovery secret and must be held outside GitHub as well. Legacy GPG archives are untouched. No database schema or application API changes are needed.
