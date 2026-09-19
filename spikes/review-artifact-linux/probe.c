#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <unistd.h>

#ifndef SYS_openat2
#define SYS_openat2 437
#endif

#ifndef SYS_renameat2
#define SYS_renameat2 316
#endif

#ifndef AT_EMPTY_PATH
#define AT_EMPTY_PATH 0x1000
#endif

#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1 << 0)
#endif

#ifndef O_PATH
#define O_PATH 010000000
#endif

#define MAX_LEAF 255
#define CASE_COUNT 13

typedef struct {
  dev_t device;
  ino_t inode;
} identity_t;

typedef struct {
  int root;
  int justice;
  int reviews;
  int leases;
  int quarantine;
} layout_t;

typedef struct {
  char artifact[MAX_LEAF + 1];
  char lease[MAX_LEAF + 1];
  identity_t identity;
} reservation_t;

typedef enum {
  RESERVATION_RACE_NONE = 0,
  RESERVATION_RACE_ARTIFACT_NAME_AFTER_FSTAT,
  RESERVATION_RACE_LEASE_NAME_AFTER_HARD_LINK,
} reservation_race_kind_t;

typedef struct {
  reservation_race_kind_t kind;
  const char *saved_name;
  const char *replacement_bytes;
  identity_t replacement_identity;
  bool replacement_recorded;
} reservation_race_context_t;

typedef struct {
  const char *name;
  bool passed;
  const char *detail;
  const char *outcome;
  bool has_race_metrics;
  int replacement_delete_count;
  int replacement_overwrite_count;
  bool replacement_bytes_retained;
  bool usable_reservation;
} case_report_t;

typedef enum {
  CLEANUP_FAILED = 0,
  CLEANUP_QUARANTINE_RETAINED = 1,
  CLEANUP_REPLACEMENT_RETAINED = 2,
} cleanup_status_t;

static const char *const case_names[CASE_COUNT] = {
    "exclusive_reservation",
    "reservation_collision",
    "descriptor_relative_io",
    "final_component_symlink",
    "symlinked_ancestor",
    "ancestor_replacement",
    "artifact_replacement",
    "lease_replacement",
    "root_close_reopen",
    "reservation_local_quarantine",
    "post_verification_quarantine_race",
    "artifact_name_replacement_after_fstat",
    "lease_name_replacement_after_hard_link",
};

static void close_fd(int *fd) {
  if (*fd >= 0) {
    (void)close(*fd);
    *fd = -1;
  }
}

static void initialize_layout(layout_t *layout) {
  layout->root = -1;
  layout->justice = -1;
  layout->reviews = -1;
  layout->leases = -1;
  layout->quarantine = -1;
}

static void close_layout(layout_t *layout) {
  close_fd(&layout->quarantine);
  close_fd(&layout->leases);
  close_fd(&layout->reviews);
  close_fd(&layout->justice);
  close_fd(&layout->root);
}

static int secure_open(int dirfd, const char *path, int flags, mode_t mode) {
  struct open_how how;

  memset(&how, 0, sizeof(how));
  how.flags = (uint64_t)flags;
  how.mode = (uint64_t)mode;
  how.resolve = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS;
  return (int)syscall(SYS_openat2, dirfd, path, &how, sizeof(how));
}

static int rename_no_replace(int source_dirfd, const char *source, int target_dirfd,
                             const char *target) {
  return (int)syscall(SYS_renameat2, source_dirfd, source, target_dirfd, target,
                       RENAME_NOREPLACE);
}

static bool identity_from_fd(int fd, identity_t *identity) {
  struct stat value;

  if (fstat(fd, &value) < 0) {
    return false;
  }
  identity->device = value.st_dev;
  identity->inode = value.st_ino;
  return true;
}

static bool identities_equal(const identity_t *left, const identity_t *right) {
  return left->device == right->device && left->inode == right->inode;
}

static bool write_at(int fd, const char *bytes) {
  size_t length = strlen(bytes);
  size_t offset = 0;

  while (offset < length) {
    ssize_t written = pwrite(fd, bytes + offset, length - offset, (off_t)offset);
    if (written <= 0) {
      return false;
    }
    offset += (size_t)written;
  }
  return true;
}

static bool read_equals(int fd, const char *expected) {
  size_t length = strlen(expected);
  char buffer[MAX_LEAF + 1];
  size_t offset = 0;

  if (length > MAX_LEAF) {
    return false;
  }
  memset(buffer, 0, sizeof(buffer));
  while (offset < length) {
    ssize_t read_count = pread(fd, buffer + offset, length - offset, (off_t)offset);
    if (read_count <= 0) {
      return false;
    }
    offset += (size_t)read_count;
  }
  return memcmp(buffer, expected, length) == 0;
}

static bool replace_named_file(int dirfd, const char *name, const char *saved,
                               const char *replacement, identity_t *replacement_identity);

static cleanup_status_t cleanup_pair(const layout_t *layout, const reservation_t *reservation,
                                     bool post_verification_race,
                                     bool *replacement_bytes_retained);

static bool make_directory(int dirfd, const char *name) {
  if (mkdirat(dirfd, name, 0700) == 0 || errno == EEXIST) {
    return true;
  }
  return false;
}

static bool open_layout(const char *root_path, layout_t *layout) {
  initialize_layout(layout);
  layout->root = openat(AT_FDCWD, root_path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (layout->root < 0 || !make_directory(layout->root, ".justice")) {
    close_layout(layout);
    return false;
  }
  layout->justice = secure_open(layout->root, ".justice", O_RDONLY | O_DIRECTORY | O_CLOEXEC |
                                                            O_NOFOLLOW,
                                0);
  if (layout->justice < 0 || !make_directory(layout->justice, "reviews")) {
    close_layout(layout);
    return false;
  }
  layout->reviews = secure_open(layout->justice, "reviews", O_RDONLY | O_DIRECTORY | O_CLOEXEC |
                                                            O_NOFOLLOW,
                                0);
  if (layout->reviews < 0 || !make_directory(layout->reviews, ".leases") ||
      !make_directory(layout->reviews, ".quarantine")) {
    close_layout(layout);
    return false;
  }
  layout->leases = secure_open(layout->reviews, ".leases", O_RDONLY | O_DIRECTORY | O_CLOEXEC |
                                                           O_NOFOLLOW,
                               0);
  layout->quarantine = secure_open(layout->reviews, ".quarantine",
                                   O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, 0);
  if (layout->leases < 0 || layout->quarantine < 0) {
    close_layout(layout);
    return false;
  }
  return true;
}

static bool create_reservation(const layout_t *layout, const char *artifact, const char *initial,
                               reservation_t *reservation,
                               reservation_race_context_t *race_context) {
  int artifact_fd = -1;
  int source_fd = -1;
  int lease_fd = -1;
  char lease[MAX_LEAF + 1];
  identity_t lease_identity;

  if (snprintf(lease, sizeof(lease), "%s.lease", artifact) >= (int)sizeof(lease)) {
    return false;
  }
  artifact_fd = secure_open(layout->reviews, artifact,
                            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (artifact_fd < 0 || !identity_from_fd(artifact_fd, &reservation->identity) ||
      !write_at(artifact_fd, initial)) {
    close_fd(&artifact_fd);
    return false;
  }
  if (race_context != NULL &&
      race_context->kind == RESERVATION_RACE_ARTIFACT_NAME_AFTER_FSTAT) {
    if (!replace_named_file(layout->reviews, artifact, race_context->saved_name,
                            race_context->replacement_bytes,
                            &race_context->replacement_identity)) {
      close_fd(&artifact_fd);
      return false;
    }
    race_context->replacement_recorded = true;
  }
  source_fd = secure_open(layout->reviews, artifact, O_PATH | O_NOFOLLOW | O_CLOEXEC, 0);
  if (source_fd < 0 || linkat(source_fd, "", layout->leases, lease, AT_EMPTY_PATH) < 0) {
    close_fd(&source_fd);
    close_fd(&artifact_fd);
    return false;
  }
  if (race_context != NULL && race_context->kind == RESERVATION_RACE_LEASE_NAME_AFTER_HARD_LINK) {
    if (!replace_named_file(layout->leases, lease, race_context->saved_name,
                            race_context->replacement_bytes,
                            &race_context->replacement_identity)) {
      close_fd(&source_fd);
      close_fd(&artifact_fd);
      return false;
    }
    race_context->replacement_recorded = true;
  }
  lease_fd = secure_open(layout->leases, lease, O_PATH | O_NOFOLLOW | O_CLOEXEC, 0);
  if (lease_fd < 0 || !identity_from_fd(lease_fd, &lease_identity) ||
      !identities_equal(&reservation->identity, &lease_identity)) {
    close_fd(&lease_fd);
    close_fd(&source_fd);
    close_fd(&artifact_fd);
    return false;
  }
  (void)snprintf(reservation->artifact, sizeof(reservation->artifact), "%s", artifact);
  (void)snprintf(reservation->lease, sizeof(reservation->lease), "%s", lease);
  close_fd(&lease_fd);
  close_fd(&source_fd);
  close_fd(&artifact_fd);
  return true;
}

static bool open_matching(const layout_t *layout, int dirfd, const char *name,
                          const identity_t *expected, int flags, int *opened_fd) {
  identity_t actual;

  *opened_fd = secure_open(dirfd, name, flags | O_CLOEXEC | O_NOFOLLOW, 0);
  if (*opened_fd < 0 || !identity_from_fd(*opened_fd, &actual) ||
      !identities_equal(expected, &actual)) {
    close_fd(opened_fd);
    return false;
  }
  (void)layout;
  return true;
}

static bool open_existing_reservation(const layout_t *layout, const reservation_t *reservation) {
  int artifact_fd = -1;
  int lease_fd = -1;
  bool valid = open_matching(layout, layout->reviews, reservation->artifact,
                             &reservation->identity, O_RDONLY, &artifact_fd) &&
               open_matching(layout, layout->leases, reservation->lease, &reservation->identity,
                             O_RDONLY, &lease_fd);
  close_fd(&lease_fd);
  close_fd(&artifact_fd);
  return valid;
}

static bool replace_named_file(int dirfd, const char *name, const char *saved,
                               const char *replacement, identity_t *replacement_identity) {
  int fd = -1;

  if (rename_no_replace(dirfd, name, dirfd, saved) < 0) {
    return false;
  }
  fd = secure_open(dirfd, name, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0 || !write_at(fd, replacement) ||
      !identity_from_fd(fd, replacement_identity)) {
    close_fd(&fd);
    return false;
  }
  close_fd(&fd);
  return true;
}

static bool named_file_equals(int dirfd, const char *name, const char *expected) {
  int fd = secure_open(dirfd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  bool matches = fd >= 0 && read_equals(fd, expected);

  close_fd(&fd);
  return matches;
}

static bool named_file_identity_equals(int dirfd, const char *name,
                                       const identity_t *expected) {
  int fd = -1;
  identity_t actual;
  bool matches;

  fd = secure_open(dirfd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  matches = fd >= 0 && identity_from_fd(fd, &actual) && identities_equal(expected, &actual);
  close_fd(&fd);
  return matches;
}

static bool target_is_absent(int dirfd, const char *name) {
  int fd = secure_open(dirfd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  int target_errno = errno;
  bool absent = fd < 0 && target_errno == ENOENT;

  close_fd(&fd);
  return absent;
}

static case_report_t report(const char *name, bool passed, const char *detail) {
  case_report_t value = {
      .name = name,
      .passed = passed,
      .detail = detail,
      .outcome = NULL,
      .has_race_metrics = false,
      .replacement_delete_count = 0,
      .replacement_overwrite_count = 0,
      .replacement_bytes_retained = false,
      .usable_reservation = false,
  };
  return value;
}

static case_report_t report_race(const char *name, bool passed, const char *detail,
                                 const char *outcome, bool bytes_retained,
                                 bool usable_reservation) {
  case_report_t value = report(name, passed, detail);

  value.outcome = outcome;
  value.has_race_metrics = true;
  value.replacement_bytes_retained = bytes_retained;
  value.usable_reservation = usable_reservation;
  return value;
}

static case_report_t case_exclusive_reservation(const layout_t *layout) {
  reservation_t reservation;
  bool passed = create_reservation(layout, "exclusive.json", "", &reservation, NULL) &&
                open_existing_reservation(layout, &reservation);

  return report(case_names[0], passed, passed ? "exclusive marker and identity-bound lease" :
                                                       "exclusive reservation failed");
}

static case_report_t case_collision(const layout_t *layout) {
  reservation_t reservation;
  int fd = -1;
  int collision_errno = 0;
  bool passed = create_reservation(layout, "collision.json", "", &reservation, NULL);

  if (passed) {
    fd = secure_open(layout->reviews, "collision.json",
                     O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    collision_errno = errno;
    close_fd(&fd);
    passed = collision_errno == EEXIST;
  }
  return report(case_names[1], passed, passed ? "second exclusive reservation collided" :
                                                       "collision was not rejected");
}

static case_report_t case_descriptor_io(const layout_t *layout) {
  reservation_t reservation;
  int fd = -1;
  bool passed = create_reservation(layout, "descriptor-io.json", "", &reservation, NULL);

  if (passed) {
    fd = secure_open(layout->reviews, reservation.artifact,
                     O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0);
    passed = fd >= 0 && identity_from_fd(fd, &reservation.identity) &&
             write_at(fd, "descriptor-relative") && read_equals(fd, "descriptor-relative");
  }
  close_fd(&fd);
  return report(case_names[2], passed, passed ? "descriptor-relative pwrite/pread" :
                                                       "descriptor-relative I/O failed");
}

static case_report_t case_final_component_symlink(const layout_t *layout) {
  int fd = -1;
  int open_errno = 0;
  bool created = symlinkat("not-a-target", layout->reviews, "final-component-link.json") == 0;
  bool rejected = false;

  if (created) {
    fd = secure_open(layout->reviews, "final-component-link.json",
                     O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
    open_errno = errno;
    rejected = fd < 0 && open_errno == ELOOP;
  }
  close_fd(&fd);
  (void)unlinkat(layout->reviews, "final-component-link.json", 0);
  return report(case_names[3], created && rejected,
                created && rejected ? "final-component symlink rejected" :
                                      "final-component symlink was followed");
}

static case_report_t case_symlinked_ancestor(const layout_t *layout) {
  int fd = -1;
  int open_errno = 0;
  bool directory_created = mkdirat(layout->reviews, "ancestor-real", 0700) == 0;
  bool link_created = directory_created &&
                      symlinkat("ancestor-real", layout->reviews, "ancestor-link") == 0;
  bool rejected = false;

  if (link_created) {
    fd = secure_open(layout->reviews, "ancestor-link/leaf.json",
                     O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
    open_errno = errno;
    rejected = fd < 0 && open_errno == ELOOP;
  }
  close_fd(&fd);
  (void)unlinkat(layout->reviews, "ancestor-link", 0);
  (void)unlinkat(layout->reviews, "ancestor-real", AT_REMOVEDIR);
  return report(case_names[4], link_created && rejected,
                link_created && rejected ? "symlinked ancestor rejected" :
                                           "symlinked ancestor was followed");
}

static case_report_t case_ancestor_replacement(layout_t *layout) {
  reservation_t reservation;
  int outside = -1;
  int outside_file = -1;
  int path_fd = -1;
  int anchored_fd = -1;
  bool prepared = create_reservation(layout, "ancestor.json", "", &reservation, NULL);
  bool swapped = false;
  bool anchored = false;
  bool path_rejected = false;
  bool original_updated = false;
  bool outside_unchanged = false;

  if (prepared) {
    prepared = mkdirat(layout->root, "ancestor-outside", 0700) == 0;
    outside = prepared ? secure_open(layout->root, "ancestor-outside",
                                     O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, 0) : -1;
    outside_file = outside >= 0
                       ? secure_open(outside, "ancestor.json",
                                     O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600)
                       : -1;
    prepared = prepared && outside_file >= 0 && write_at(outside_file, "outside");
  }
  close_fd(&outside_file);
  if (prepared) {
    swapped = rename_no_replace(layout->justice, "reviews", layout->justice,
                                "reviews.original") == 0 &&
              symlinkat("../ancestor-outside", layout->justice, "reviews") == 0;
  }
  if (swapped) {
    anchored_fd = secure_open(layout->reviews, reservation.artifact,
                              O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0);
    anchored = anchored_fd >= 0 && write_at(anchored_fd, "inside") &&
               read_equals(anchored_fd, "inside");
    path_fd = secure_open(layout->justice, "reviews/ancestor.json",
                          O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
    path_rejected = path_fd < 0 && errno == ELOOP;
  }
  close_fd(&path_fd);
  close_fd(&anchored_fd);
  if (swapped) {
    int original = secure_open(layout->justice, "reviews.original",
                               O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, 0);
    int original_file = original >= 0
                            ? secure_open(original, reservation.artifact,
                                          O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0)
                            : -1;
    original_updated = original_file >= 0 && read_equals(original_file, "inside");
    close_fd(&original_file);
    close_fd(&original);
  }
  if (outside >= 0) {
    int current = secure_open(outside, "ancestor.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
    outside_unchanged = current >= 0 && read_equals(current, "outside");
    close_fd(&current);
  }
  close_fd(&outside);
  if (swapped) {
    (void)unlinkat(layout->justice, "reviews", 0);
    (void)rename_no_replace(layout->justice, "reviews.original", layout->justice, "reviews");
  }
  return report(case_names[5], anchored && path_rejected && original_updated && outside_unchanged,
                anchored && path_rejected && original_updated && outside_unchanged
                    ? "original descriptor remained anchored"
                    : "ancestor replacement was not contained");
}

static case_report_t case_artifact_replacement(const layout_t *layout) {
  reservation_t reservation;
  identity_t replacement_identity;
  bool replacement_identity_retained = false;
  bool replacement_bytes_retained = false;
  bool usable_reservation = false;
  cleanup_status_t cleanup_status = CLEANUP_FAILED;
  bool replaced = create_reservation(layout, "artifact-replacement.json", "", &reservation, NULL);
  if (replaced) {
    replaced = replace_named_file(layout->reviews, reservation.artifact,
                                  "artifact-replacement.saved", "replacement",
                                  &replacement_identity);
  }
  bool mismatch = replaced && !identities_equal(&reservation.identity, &replacement_identity);
  if (replaced) {
    cleanup_status = cleanup_pair(layout, &reservation, false, &replacement_bytes_retained);
    replacement_identity_retained = named_file_identity_equals(
        layout->reviews, reservation.artifact, &replacement_identity);
    replacement_bytes_retained = replacement_identity_retained &&
                                  named_file_equals(layout->reviews, reservation.artifact,
                                                    "replacement");
    usable_reservation = open_existing_reservation(layout, &reservation);
  }
  case_report_t value = report_race(
      case_names[6], replaced && mismatch && cleanup_status == CLEANUP_REPLACEMENT_RETAINED &&
                         replacement_identity_retained && replacement_bytes_retained &&
                         !usable_reservation,
      replaced && mismatch && cleanup_status == CLEANUP_REPLACEMENT_RETAINED &&
              replacement_identity_retained && replacement_bytes_retained && !usable_reservation
          ? "artifact replacement retained by cleanup"
          : "artifact replacement was touched or cleanup did not fail closed",
      "replacement_retained", replacement_bytes_retained, usable_reservation);
  value.replacement_delete_count = replacement_identity_retained ? 0 : 1;
  value.replacement_overwrite_count = replacement_bytes_retained ? 0 : 1;
  return value;
}

static case_report_t case_lease_replacement(const layout_t *layout) {
  reservation_t reservation;
  identity_t replacement_identity;
  bool replacement_identity_retained = false;
  bool replacement_bytes_retained = false;
  bool usable_reservation = false;
  cleanup_status_t cleanup_status = CLEANUP_FAILED;
  bool replaced = create_reservation(layout, "lease-replacement.json", "", &reservation, NULL);
  if (replaced) {
    replaced = replace_named_file(layout->leases, reservation.lease,
                                  "lease-replacement.saved", "lease-replacement",
                                  &replacement_identity);
  }
  bool mismatch = replaced && !identities_equal(&reservation.identity, &replacement_identity);
  if (replaced) {
    cleanup_status = cleanup_pair(layout, &reservation, false, &replacement_bytes_retained);
    replacement_identity_retained = named_file_identity_equals(
        layout->leases, reservation.lease, &replacement_identity);
    replacement_bytes_retained = replacement_identity_retained &&
                                  named_file_equals(layout->leases, reservation.lease,
                                                    "lease-replacement");
    usable_reservation = open_existing_reservation(layout, &reservation);
  }
  case_report_t value = report_race(
      case_names[7], replaced && mismatch && cleanup_status == CLEANUP_REPLACEMENT_RETAINED &&
                         replacement_identity_retained && replacement_bytes_retained &&
                         !usable_reservation,
      replaced && mismatch && cleanup_status == CLEANUP_REPLACEMENT_RETAINED &&
              replacement_identity_retained && replacement_bytes_retained && !usable_reservation
          ? "lease replacement retained by cleanup"
          : "lease replacement was touched or cleanup did not fail closed",
      "replacement_retained", replacement_bytes_retained, usable_reservation);
  value.replacement_delete_count = replacement_identity_retained ? 0 : 1;
  value.replacement_overwrite_count = replacement_bytes_retained ? 0 : 1;
  return value;
}

static case_report_t case_root_close_reopen(const char *root_path, layout_t *layout) {
  reservation_t reservation;
  bool created = create_reservation(layout, "reopen.json", "", &reservation, NULL);

  close_layout(layout);
  bool reopened = created && open_layout(root_path, layout);
  bool passed = reopened && open_existing_reservation(layout, &reservation);

  return report(case_names[8], passed, passed ? "root close/reopen preserved descriptor contract" :
                                                       "openExistingReservation failed after reopen");
}

static bool open_quarantine_scope(const layout_t *layout, const char *artifact,
                                  int *scope_fd) {
  if (mkdirat(layout->quarantine, artifact, 0700) < 0 && errno != EEXIST) {
    return false;
  }
  *scope_fd = secure_open(layout->quarantine, artifact,
                          O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, 0);
  return *scope_fd >= 0;
}

static bool move_matching_leaf(int source_dirfd, const char *source_name,
                               const identity_t *expected, int quarantine_fd,
                               const char *quarantine_name) {
  int source_fd = -1;
  int moved_fd = -1;
  int original_fd = -1;
  int original_errno = 0;
  identity_t source_identity;
  identity_t moved_identity;

  source_fd = secure_open(source_dirfd, source_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  if (source_fd < 0 || !identity_from_fd(source_fd, &source_identity) ||
      !identities_equal(expected, &source_identity) ||
      rename_no_replace(source_dirfd, source_name, quarantine_fd, quarantine_name) < 0) {
    close_fd(&source_fd);
    return false;
  }
  moved_fd = secure_open(quarantine_fd, quarantine_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  if (moved_fd < 0 || !identity_from_fd(moved_fd, &moved_identity) ||
      !identities_equal(expected, &moved_identity)) {
    close_fd(&moved_fd);
    close_fd(&source_fd);
    return false;
  }
  original_fd = secure_open(source_dirfd, source_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  original_errno = errno;
  close_fd(&original_fd);
  close_fd(&moved_fd);
  close_fd(&source_fd);
  return original_fd < 0 && original_errno == ENOENT;
}

static bool replace_quarantine_name(int quarantine_fd, const char *name, const char *saved,
                                    const char *replacement) {
  identity_t ignored;
  return replace_named_file(quarantine_fd, name, saved, replacement, &ignored);
}

static cleanup_status_t cleanup_pair(const layout_t *layout, const reservation_t *reservation,
                                     bool post_verification_race,
                                     bool *replacement_bytes_retained) {
  int scope = -1;
  int artifact_fd = -1;
  int lease_fd = -1;
  bool artifact_moved = false;
  bool lease_moved = false;
  bool artifact_verified = false;
  bool lease_verified = false;

  *replacement_bytes_retained = false;
  if (!open_quarantine_scope(layout, reservation->artifact, &scope)) {
    return CLEANUP_FAILED;
  }
  artifact_moved = move_matching_leaf(layout->reviews, reservation->artifact,
                                      &reservation->identity, scope, "artifact");
  lease_moved = artifact_moved &&
                move_matching_leaf(layout->leases, reservation->lease, &reservation->identity,
                                   scope, "lease");
  if (!artifact_moved || !lease_moved) {
    close_fd(&scope);
    return CLEANUP_REPLACEMENT_RETAINED;
  }
  artifact_fd = secure_open(scope, "artifact", O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  lease_fd = secure_open(scope, "lease", O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0);
  if (artifact_fd >= 0 && lease_fd >= 0) {
                    identity_t artifact_identity;
    identity_t lease_identity;
    artifact_verified = identity_from_fd(artifact_fd, &artifact_identity) &&
                        identities_equal(&reservation->identity, &artifact_identity) &&
                        target_is_absent(layout->reviews, reservation->artifact);
    lease_verified = identity_from_fd(lease_fd, &lease_identity) &&
                     identities_equal(&reservation->identity, &lease_identity) &&
                     target_is_absent(layout->leases, reservation->lease);
  }
  close_fd(&lease_fd);
  close_fd(&artifact_fd);
  if (!artifact_verified || !lease_verified) {
    close_fd(&scope);
    return CLEANUP_FAILED;
  }
  if (post_verification_race &&
      !replace_quarantine_name(scope, "artifact", "artifact.saved", "replacement-after-verify")) {
    close_fd(&scope);
    return CLEANUP_FAILED;
  }
  if (post_verification_race) {
    *replacement_bytes_retained = named_file_equals(scope, "artifact", "replacement-after-verify");
  }
  close_fd(&scope);
  return CLEANUP_QUARANTINE_RETAINED;
}

static case_report_t case_reservation_local_quarantine(const layout_t *layout) {
  reservation_t reservation;
  bool replacement_retained = false;
  bool created = create_reservation(layout, "quarantine.json", "quarantine-bytes", &reservation, NULL);
  cleanup_status_t status = created ? cleanup_pair(layout, &reservation, false, &replacement_retained)
                                    : CLEANUP_FAILED;
  bool passed = status == CLEANUP_QUARANTINE_RETAINED && !replacement_retained;

  case_report_t value = report_race(
      case_names[9], passed,
      passed ? "matching pair retained in reservation-local quarantine" :
               "reservation-local quarantine failed",
      "quarantine_retained", false, false);
  value.replacement_delete_count = 0;
  value.replacement_overwrite_count = 0;
  return value;
}

static case_report_t case_post_verification_race(const layout_t *layout) {
  reservation_t reservation;
  bool replacement_retained = false;
  bool created = create_reservation(layout, "quarantine-race.json", "original", &reservation, NULL);
  cleanup_status_t status = created ? cleanup_pair(layout, &reservation, true, &replacement_retained)
                                    : CLEANUP_FAILED;
  bool passed = status == CLEANUP_QUARANTINE_RETAINED && replacement_retained;

  case_report_t value = report_race(case_names[10], passed,
                                    passed ? "replacement survived post-verification race" :
                                             "post-verification replacement was touched",
                                    "quarantine_retained", replacement_retained, false);
  value.replacement_delete_count = 0;
  value.replacement_overwrite_count = 0;
  return value;
}

static case_report_t case_artifact_creation_race(const layout_t *layout) {
  const char *artifact = "reservation-artifact-race.json";
  reservation_t reservation;
  reservation_race_context_t race = {
      .kind = RESERVATION_RACE_ARTIFACT_NAME_AFTER_FSTAT,
      .saved_name = "reservation-artifact-race.saved",
      .replacement_bytes = "artifact-replacement",
      .replacement_recorded = false,
  };
  bool created = create_reservation(layout, artifact, "", &reservation, &race);
  bool usable_reservation = created && open_existing_reservation(layout, &reservation);
  bool replacement_identity_retained =
      race.replacement_recorded &&
      named_file_identity_equals(layout->reviews, artifact, &race.replacement_identity);
  bool replacement_bytes_retained =
      replacement_identity_retained && named_file_equals(layout->reviews, artifact,
                                                          race.replacement_bytes);
  bool passed = race.replacement_recorded && !usable_reservation &&
                replacement_identity_retained && replacement_bytes_retained && !created;
  case_report_t value = report_race(case_names[11], passed,
                                    passed ? "artifact replacement retained; reservation unusable" :
                                             "artifact creation race produced a usable reservation",
                                    "artifact_storage_unavailable", replacement_bytes_retained,
                                    usable_reservation);
  value.replacement_delete_count = replacement_identity_retained ? 0 : 1;
  value.replacement_overwrite_count = replacement_bytes_retained ? 0 : 1;
  return value;
}

static case_report_t case_lease_creation_race(const layout_t *layout) {
  const char *artifact = "reservation-lease-race.json";
  const char *lease = "reservation-lease-race.json.lease";
  reservation_t reservation;
  reservation_race_context_t race = {
      .kind = RESERVATION_RACE_LEASE_NAME_AFTER_HARD_LINK,
      .saved_name = "reservation-lease-race.json.lease.saved",
      .replacement_bytes = "lease-replacement",
      .replacement_recorded = false,
  };
  bool created = create_reservation(layout, artifact, "", &reservation, &race);
  bool usable_reservation = created && open_existing_reservation(layout, &reservation);
  bool replacement_identity_retained =
      race.replacement_recorded &&
      named_file_identity_equals(layout->leases, lease, &race.replacement_identity);
  bool replacement_bytes_retained =
      replacement_identity_retained && named_file_equals(layout->leases, lease,
                                                          race.replacement_bytes);
  bool passed = race.replacement_recorded && !usable_reservation &&
                replacement_identity_retained && replacement_bytes_retained && !created;
  case_report_t value = report_race(case_names[12], passed,
                                    passed ? "lease replacement retained; reservation unusable" :
                                             "lease creation race produced a usable reservation",
                                    "artifact_storage_unavailable", replacement_bytes_retained,
                                    usable_reservation);
  value.replacement_delete_count = replacement_identity_retained ? 0 : 1;
  value.replacement_overwrite_count = replacement_bytes_retained ? 0 : 1;
  return value;
}

static bool openat2_available(const char *root_path) {
  int root = openat(AT_FDCWD, root_path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  int probe_fd;
  int probe_errno;
  bool available;

  if (root < 0) {
    return false;
  }
  probe_fd = secure_open(root, ".", O_PATH | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, 0);
  probe_errno = errno;
  available = probe_fd >= 0 || probe_errno != ENOSYS;
  close_fd(&probe_fd);
  close_fd(&root);
  return available;
}

static bool renameat2_available(void) {
  long result = syscall(SYS_renameat2, -1, "", -1, "", RENAME_NOREPLACE);

  return result == 0 || errno != ENOSYS;
}

static const char *detect_libc(void) {
#ifdef _CS_GNU_LIBC_VERSION
  char version[32];

  return confstr(_CS_GNU_LIBC_VERSION, version, sizeof(version)) > 0 ? "glibc" : "unknown";
#else
  return "unknown";
#endif
}

static void print_blocked_report(bool openat2_ok, bool renameat2_ok, const char *kernel) {
  size_t index;

  printf("{\"provider\":\"LinuxOpenat2ReviewArtifactProvider\",\"nativeApi\":{"
         "\"openat2\":%s,\"renameat2\":%s,\"descriptorRelative\":false,\"identityBoundLease\":false},"
         "\"platform\":{\"os\":\"linux\",\"arch\":\"x86_64\",\"libc\":\"glibc\"},"
         "\"kernel\":\"%s\",\"status\":\"BLOCKED\",\"cases\":{" ,
         openat2_ok ? "true" : "false", renameat2_ok ? "true" : "false", kernel);
  for (index = 0; index < CASE_COUNT; ++index) {
    printf("%s\"%s\":{\"status\":\"BLOCKED\",\"detail\":\"required syscall unavailable\"}",
           index == 0 ? "" : ",", case_names[index]);
  }
  printf("}}\n");
}

static void print_report(const case_report_t *reports, bool passed, bool openat2_ok,
                         bool renameat2_ok, const char *arch, const char *libc,
                         const char *kernel) {
  size_t index;

  printf("{\"provider\":\"LinuxOpenat2ReviewArtifactProvider\",\"nativeApi\":{"
         "\"openat2\":%s,\"renameat2\":%s,\"openat\":true,\"linkat\":true,\"fstat\":true,"
         "\"pread\":true,\"pwrite\":true,\"unlinkat\":true,\"descriptorRelative\":true,"
         "\"identityBoundLease\":true},\"platform\":{\"os\":\"linux\",\"arch\":\"%s\","
         "\"libc\":\"%s\"},\"kernel\":\"%s\",\"status\":\"%s\",\"cases\":{" ,
         openat2_ok ? "true" : "false", renameat2_ok ? "true" : "false", arch, libc, kernel,
         passed ? "PASS" : "FAIL");
  for (index = 0; index < CASE_COUNT; ++index) {
    const case_report_t *current = &reports[index];

    printf("%s\"%s\":{\"status\":\"%s\",\"detail\":\"%s\"",
           index == 0 ? "" : ",", current->name, current->passed ? "PASS" : "FAIL",
           current->detail);
    if (current->outcome != NULL) {
      printf(",\"outcome\":\"%s\",\"replacement_delete_count\":%d,"
             "\"replacement_overwrite_count\":%d,\"replacement_bytes_retained\":%s,"
             "\"usable_reservation\":%s",
             current->outcome, current->replacement_delete_count,
             current->replacement_overwrite_count,
             current->replacement_bytes_retained ? "true" : "false",
             current->usable_reservation ? "true" : "false");
    }
    printf("}");
  }
  printf("}}\n");
}

int main(int argc, char **argv) {
  layout_t layout;
  case_report_t reports[CASE_COUNT];
  struct utsname system_info;
  const char *libc;
  bool openat2_ok;
  bool renameat2_ok;
  bool all_passed = true;

  if (argc != 2 || uname(&system_info) < 0) {
    return 2;
  }
  libc = detect_libc();
  openat2_ok = openat2_available(argv[1]);
  renameat2_ok = renameat2_available();
  if (!openat2_ok || !renameat2_ok) {
    print_blocked_report(openat2_ok, renameat2_ok, system_info.release);
    return 0;
  }
  if (!open_layout(argv[1], &layout)) {
    return 2;
  }

  reports[0] = case_exclusive_reservation(&layout);
  reports[1] = case_collision(&layout);
  reports[2] = case_descriptor_io(&layout);
  reports[3] = case_final_component_symlink(&layout);
  reports[4] = case_symlinked_ancestor(&layout);
  reports[5] = case_ancestor_replacement(&layout);
  reports[6] = case_artifact_replacement(&layout);
  reports[7] = case_lease_replacement(&layout);
  reports[8] = case_root_close_reopen(argv[1], &layout);
  reports[9] = case_reservation_local_quarantine(&layout);
  reports[10] = case_post_verification_race(&layout);
  reports[11] = case_artifact_creation_race(&layout);
  reports[12] = case_lease_creation_race(&layout);
  for (size_t index = 0; index < CASE_COUNT; ++index) {
    all_passed = all_passed && reports[index].passed;
  }
  print_report(reports, all_passed, openat2_ok, renameat2_ok, system_info.machine, libc,
               system_info.release);
  close_layout(&layout);
  return 0;
}
