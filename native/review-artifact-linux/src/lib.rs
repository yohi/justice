#![deny(clippy::all, clippy::pedantic)]

use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd};
use std::path::Path;

use napi::bindgen_prelude::Buffer;
use napi::{Error, Result};
use napi_derive::napi;

const SYS_OPENAT2: libc::c_long = 437;
const SYS_RENAMEAT2: libc::c_long = 316;
const RESOLVE_NO_MAGICLINKS: u64 = 0x02;
const RESOLVE_NO_SYMLINKS: u64 = 0x04;
const RESOLVE_BENEATH: u64 = 0x08;
const AT_FDCWD: libc::c_int = -100;
const AT_SYMLINK_FOLLOW: libc::c_int = 0x400;
const RENAME_NOREPLACE: libc::c_uint = 1;
const MAX_ARTIFACT_BYTES: usize = 1024 * 1024;

#[repr(C)]
struct OpenHow {
    flags: u64,
    mode: u64,
    resolve: u64,
}

#[allow(clippy::struct_excessive_bools)]
#[napi(object)]
pub struct NativeCapabilities {
    pub linux: bool,
    pub x64: bool,
    pub glibc: bool,
    pub openat2: bool,
    pub renameat2: bool,
}

#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeIdentity {
    pub device: String,
    pub inode: String,
}

#[napi(object)]
pub struct ReservationDescriptor {
    pub artifact_path: String,
    pub lease_path: String,
    pub artifact_identity: NativeIdentity,
}

#[napi(object)]
pub struct CleanupResult {
    pub status: String,
}

#[napi]
pub struct ReservationHandle {
    artifact_fd: Option<OwnedFd>,
    lease_path: String,
    identity: NativeIdentity,
}

#[napi]
impl ReservationHandle {
    #[napi(js_name = "artifactIdentity")]
    #[must_use]
    pub fn artifact_identity(&self) -> NativeIdentity {
        NativeIdentity {
            device: self.identity.device.clone(),
            inode: self.identity.inode.clone(),
        }
    }

    #[napi(js_name = "leasePath")]
    #[must_use]
    pub fn lease_path(&self) -> String {
        self.lease_path.clone()
    }

    #[napi]
    pub fn close(&mut self) {
        self.artifact_fd = None;
    }
}

#[allow(clippy::struct_field_names)]
#[napi]
pub struct ReviewArtifactRoot {
    reviews_fd: Option<OwnedFd>,
    leases_fd: Option<OwnedFd>,
    quarantine_fd: Option<OwnedFd>,
}

#[napi]
impl ReviewArtifactRoot {
    #[napi]
    /// # Errors
    /// Returns a stable N-API error when the artifact path is invalid or the
    /// descriptor-relative reservation cannot be created.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create_exclusive_marker(&self, artifact_path: String) -> Result<ReservationHandle> {
        let (reviews_fd, leases_fd, _) = self.directory_fds()?;
        let artifact_leaf = artifact_leaf(&artifact_path)?;
        let artifact_fd = open_relative(
            reviews_fd.as_raw_fd(),
            artifact_leaf,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
        .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
        let identity = file_identity(&artifact_fd)
            .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
        let lease_leaf = lease_leaf(artifact_leaf)?;
        if let Err(error) = link_fd(artifact_fd.as_raw_fd(), leases_fd.as_raw_fd(), &lease_leaf) {
            if error.raw_os_error() == Some(libc::EEXIST) {
                let _ = unlink_relative(reviews_fd.as_raw_fd(), artifact_leaf);
                return Err(Error::from_reason("artifact_occupied"));
            }
            let _ = unlink_relative(reviews_fd.as_raw_fd(), artifact_leaf);
            return Err(map_io_error(&error, "artifact_storage_unavailable"));
        }
        Ok(ReservationHandle {
            artifact_fd: Some(artifact_fd),
            lease_path: format!(".justice/reviews/.leases/{lease_leaf}"),
            identity,
        })
    }

    #[napi]
    /// # Errors
    /// Returns a stable N-API error when the durable reservation is missing,
    /// invalid, or cannot be reopened safely.
    #[allow(clippy::needless_pass_by_value)]
    pub fn open_existing_reservation(
        &self,
        descriptor: ReservationDescriptor,
    ) -> Result<ReservationHandle> {
        let (reviews_fd, leases_fd, _) = self.directory_fds()?;
        let artifact_leaf = artifact_leaf(&descriptor.artifact_path)?;
        let expected_lease = lease_leaf(artifact_leaf)?;
        let supplied_lease = lease_leaf_from_path(&descriptor.lease_path)?;
        if supplied_lease != expected_lease {
            return Err(Error::from_reason("artifact_path_invalid"));
        }
        let artifact_fd = open_relative(
            reviews_fd.as_raw_fd(),
            artifact_leaf,
            libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
        .map_err(|error| map_io_error(&error, "artifact_missing"))?;
        let lease_file_fd = open_relative(
            leases_fd.as_raw_fd(),
            supplied_lease,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
        .map_err(|error| map_io_error(&error, "artifact_missing"))?;
        let actual = file_identity(&artifact_fd)
            .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
        let lease_identity = file_identity(&lease_file_fd)
            .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
        if actual.device != descriptor.artifact_identity.device
            || actual.inode != descriptor.artifact_identity.inode
            || lease_identity != actual
        {
            return Err(Error::from_reason("artifact_path_invalid"));
        }
        Ok(ReservationHandle {
            artifact_fd: Some(artifact_fd),
            lease_path: descriptor.lease_path,
            identity: actual,
        })
    }

    #[napi]
    /// # Errors
    /// Returns a stable N-API error when the reservation handle is closed or
    /// the bounded write fails.
    #[allow(clippy::needless_pass_by_value)]
    pub fn write_existing(&self, handle: &ReservationHandle, bytes: Buffer) -> Result<()> {
        let fd = handle
            .artifact_fd
            .as_ref()
            .ok_or_else(|| Error::from_reason("root_closed"))?;
        ftruncate(fd.as_raw_fd(), bytes.len())
            .map_err(|error| map_io_error(&error, "artifact_write_failed"))?;
        write_all(fd.as_raw_fd(), bytes.as_ref())
            .map_err(|error| map_io_error(&error, "artifact_write_failed"))
    }

    #[napi]
    /// # Errors
    /// Returns a stable N-API error when the reservation handle is closed or
    /// the bounded read fails.
    pub fn read_once(&self, handle: &ReservationHandle) -> Result<Buffer> {
        let fd = handle
            .artifact_fd
            .as_ref()
            .ok_or_else(|| Error::from_reason("root_closed"))?;
        let size = file_size(fd).map_err(|error| map_io_error(&error, "artifact_read_failed"))?;
        if size > MAX_ARTIFACT_BYTES {
            return Err(Error::from_reason("artifact_read_failed"));
        }
        let mut bytes = vec![0_u8; size];
        read_all(fd.as_raw_fd(), &mut bytes)
            .map_err(|error| map_io_error(&error, "artifact_read_failed"))?;
        Ok(Buffer::from(bytes))
    }

    #[napi]
    /// # Errors
    /// Returns a stable N-API error when cleanup cannot verify or quarantine
    /// the reservation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn cleanup_existing_reservation(
        &self,
        descriptor: ReservationDescriptor,
    ) -> Result<CleanupResult> {
        let (reviews_fd, leases_fd, quarantine_fd) = self.directory_fds()?;
        let artifact_leaf = artifact_leaf(&descriptor.artifact_path)?;
        let expected_lease = lease_leaf(artifact_leaf)?;
        let lease_leaf = lease_leaf_from_path(&descriptor.lease_path)?;
        if lease_leaf != expected_lease {
            return Err(Error::from_reason("artifact_path_invalid"));
        }
        let quarantine_artifact = quarantine_leaf(artifact_leaf, "artifact")?;
        let quarantine_lease = quarantine_leaf(lease_leaf, "lease")?;
        let artifact_fd = open_relative(
            reviews_fd.as_raw_fd(),
            artifact_leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
        .map_err(|error| map_io_error(&error, "artifact_cleanup_failed"))?;
        let actual = file_identity(&artifact_fd)
            .map_err(|error| map_io_error(&error, "artifact_cleanup_failed"))?;
        let opened_lease = match open_relative(
            leases_fd.as_raw_fd(),
            lease_leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        ) {
            Ok(fd) => fd,
            Err(error) if error.raw_os_error() == Some(libc::ENOENT) => {
                return Ok(CleanupResult {
                    status: "cleanup_incomplete".to_string(),
                });
            }
            Err(error) => return Err(cleanup_status(&error)),
        };
        let lease_identity = file_identity(&opened_lease)
            .map_err(|error| map_io_error(&error, "artifact_cleanup_failed"))?;
        if actual.device != descriptor.artifact_identity.device
            || actual.inode != descriptor.artifact_identity.inode
            || lease_identity != actual
        {
            return Ok(CleanupResult {
                status: "replacement_retained".to_string(),
            });
        }
        if let Err(error) = rename_noreplace(
            reviews_fd.as_raw_fd(),
            artifact_leaf,
            quarantine_fd.as_raw_fd(),
            &quarantine_artifact,
        ) {
            if error.raw_os_error() == Some(libc::EEXIST) {
                return Ok(CleanupResult {
                    status: "replacement_retained".to_string(),
                });
            }
            return Err(cleanup_status(&error));
        }
        if let Err(error) = rename_noreplace(
            leases_fd.as_raw_fd(),
            lease_leaf,
            quarantine_fd.as_raw_fd(),
            &quarantine_lease,
        ) {
            return Ok(CleanupResult {
                status: if error.raw_os_error() == Some(libc::EEXIST) {
                    "replacement_retained".to_string()
                } else {
                    "cleanup_incomplete".to_string()
                },
            });
        }
        let moved_artifact = open_relative(
            quarantine_fd.as_raw_fd(),
            &quarantine_artifact,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
        .and_then(|fd| file_identity(&fd));
        let moved_lease = open_relative(
            quarantine_fd.as_raw_fd(),
            &quarantine_lease,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
        .and_then(|fd| file_identity(&fd));
        if moved_artifact.as_ref().ok() != Some(&actual)
            || moved_lease.as_ref().ok() != Some(&actual)
            || !leaf_is_absent(reviews_fd.as_raw_fd(), artifact_leaf)
            || !leaf_is_absent(leases_fd.as_raw_fd(), lease_leaf)
        {
            return Ok(CleanupResult {
                status: "cleanup_incomplete".to_string(),
            });
        }
        Ok(CleanupResult {
            status: "quarantine_retained".to_string(),
        })
    }

    #[napi]
    pub fn close(&mut self) {
        self.reviews_fd = None;
        self.leases_fd = None;
        self.quarantine_fd = None;
    }

    fn directory_fds(&self) -> Result<(&OwnedFd, &OwnedFd, &OwnedFd)> {
        match (&self.reviews_fd, &self.leases_fd, &self.quarantine_fd) {
            (Some(reviews), Some(leases), Some(quarantine)) => Ok((reviews, leases, quarantine)),
            _ => Err(Error::from_reason("root_closed")),
        }
    }
}

#[napi]
#[must_use]
pub fn probe_review_artifact_capabilities() -> NativeCapabilities {
    NativeCapabilities {
        linux: cfg!(target_os = "linux"),
        x64: cfg!(target_arch = "x86_64"),
        glibc: cfg!(target_env = "gnu"),
        openat2: probe_syscall(SYS_OPENAT2),
        renameat2: probe_syscall(SYS_RENAMEAT2),
    }
}

#[napi]
/// # Errors
/// Returns a stable N-API error when the runtime lacks the required syscalls
/// or the review-artifact directory cannot be initialized.
#[allow(clippy::needless_pass_by_value)]
pub fn open_review_artifact_root(root_dir: String) -> Result<ReviewArtifactRoot> {
    if !cfg!(target_os = "linux") || !cfg!(target_arch = "x86_64") || !cfg!(target_env = "gnu") {
        return Err(Error::from_reason("unsupported_runtime"));
    }
    if !probe_syscall(SYS_OPENAT2) || !probe_syscall(SYS_RENAMEAT2) {
        return Err(Error::from_reason("unsupported_runtime"));
    }
    let root = std::fs::File::open(Path::new(&root_dir))
        .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    let root_fd = into_owned_fd(root);
    mkdir_relative(root_fd.as_raw_fd(), ".justice", 0o700)
        .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    let justice_fd = open_relative(
        root_fd.as_raw_fd(),
        ".justice",
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
    )
    .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    mkdir_relative(justice_fd.as_raw_fd(), "reviews", 0o700)
        .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    let reviews_fd = open_relative(
        justice_fd.as_raw_fd(),
        "reviews",
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
    )
    .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    mkdir_relative(reviews_fd.as_raw_fd(), ".leases", 0o700)
        .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    mkdir_relative(reviews_fd.as_raw_fd(), ".quarantine", 0o700)
        .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    let leases_fd = open_relative(
        reviews_fd.as_raw_fd(),
        ".leases",
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
    )
    .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    let quarantine_fd = open_relative(
        reviews_fd.as_raw_fd(),
        ".quarantine",
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
    )
    .map_err(|error| map_io_error(&error, "artifact_storage_unavailable"))?;
    Ok(ReviewArtifactRoot {
        reviews_fd: Some(reviews_fd),
        leases_fd: Some(leases_fd),
        quarantine_fd: Some(quarantine_fd),
    })
}

#[allow(clippy::case_sensitive_file_extension_comparisons)]
fn artifact_leaf(path: &str) -> Result<&str> {
    let leaf = path
        .strip_prefix(".justice/reviews/")
        .ok_or_else(|| Error::from_reason("artifact_path_invalid"))?;
    if leaf.is_empty()
        || leaf.contains('/')
        || leaf.contains('\\')
        || !leaf.ends_with(".json")
        || leaf.starts_with('.')
    {
        return Err(Error::from_reason("artifact_path_invalid"));
    }
    Ok(leaf)
}

fn lease_leaf(path: &str) -> Result<String> {
    let artifact_id = path
        .strip_suffix(".json")
        .ok_or_else(|| Error::from_reason("artifact_path_invalid"))?;
    Ok(format!("{artifact_id}.lease"))
}

#[allow(clippy::case_sensitive_file_extension_comparisons)]
fn lease_leaf_from_path(path: &str) -> Result<&str> {
    let leaf = path
        .strip_prefix(".justice/reviews/.leases/")
        .ok_or_else(|| Error::from_reason("artifact_path_invalid"))?;
    if leaf.is_empty() || leaf.contains('/') || leaf.contains('\\') || !leaf.ends_with(".lease") {
        return Err(Error::from_reason("artifact_path_invalid"));
    }
    Ok(leaf)
}

fn quarantine_leaf(leaf: &str, kind: &str) -> Result<String> {
    let id = leaf
        .rsplit_once('.')
        .map(|(value, _)| value)
        .ok_or_else(|| Error::from_reason("artifact_path_invalid"))?;
    Ok(format!("{id}.{kind}"))
}

fn file_identity(fd: &OwnedFd) -> io::Result<NativeIdentity> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: `fd` is a live descriptor and `stat` points to writable storage of the exact libc type.
    let result = unsafe { libc::fstat(fd.as_raw_fd(), stat.as_mut_ptr()) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: fstat initialized `stat` when it returned zero.
    let stat = unsafe { stat.assume_init() };
    Ok(NativeIdentity {
        device: stat.st_dev.to_string(),
        inode: stat.st_ino.to_string(),
    })
}

fn leaf_is_absent(dirfd: RawFd, leaf: &str) -> bool {
    matches!(
        open_relative(
            dirfd,
            leaf,
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        ),
        Err(error) if error.raw_os_error() == Some(libc::ENOENT)
    )
}

fn open_relative(
    dirfd: RawFd,
    path: &str,
    flags: libc::c_int,
    mode: libc::mode_t,
) -> io::Result<OwnedFd> {
    let path = CString::new(path).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    let how = OpenHow {
        flags: u64::try_from(flags).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?,
        mode: u64::from(mode),
        resolve: RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS,
    };
    // SAFETY: syscall receives valid pointers to NUL-terminated path and repr(C) open_how.
    let fd = checked_syscall_fd(unsafe {
        libc::syscall(
            SYS_OPENAT2,
            dirfd,
            path.as_ptr(),
            &raw const how,
            std::mem::size_of::<OpenHow>(),
        )
    })?;
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the syscall returned a newly owned file descriptor.
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn checked_syscall_fd(result: libc::c_long) -> io::Result<libc::c_int> {
    libc::c_int::try_from(result).map_err(|_| io::Error::from_raw_os_error(libc::EOVERFLOW))
}

fn mkdir_relative(dirfd: RawFd, path: &str, mode: libc::mode_t) -> io::Result<()> {
    let path = CString::new(path).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    // SAFETY: path is a validated NUL-terminated relative component and dirfd is owned by the root.
    let result = unsafe { libc::mkdirat(dirfd, path.as_ptr(), mode) };
    if result != 0 && io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn link_fd(source_fd: RawFd, target_dirfd: RawFd, target: &str) -> io::Result<()> {
    let source = CString::new(format!("/proc/self/fd/{source_fd}"))
        .map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    let target = CString::new(target).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    // SAFETY: `/proc/self/fd/<source_fd>` is the kernel-owned symlink for the
    // live descriptor, and target is a validated leaf beneath the owned directory.
    let result = unsafe {
        libc::linkat(
            AT_FDCWD,
            source.as_ptr(),
            target_dirfd,
            target.as_ptr(),
            AT_SYMLINK_FOLLOW,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn unlink_relative(dirfd: RawFd, path: &str) -> io::Result<()> {
    let path = CString::new(path).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    // SAFETY: path is a validated leaf under the owned directory descriptor.
    let result = unsafe { libc::unlinkat(dirfd, path.as_ptr(), 0) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn rename_noreplace(from_dirfd: RawFd, from: &str, to_dirfd: RawFd, to: &str) -> io::Result<()> {
    let from = CString::new(from).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    let to = CString::new(to).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    // SAFETY: both paths are validated leaves beneath owned directory descriptors.
    let result = unsafe {
        libc::syscall(
            SYS_RENAMEAT2,
            from_dirfd,
            from.as_ptr(),
            to_dirfd,
            to.as_ptr(),
            RENAME_NOREPLACE,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn ftruncate(fd: RawFd, size: usize) -> io::Result<()> {
    let size =
        libc::off_t::try_from(size).map_err(|_| io::Error::from_raw_os_error(libc::EOVERFLOW))?;
    // SAFETY: fd is an owned regular-file descriptor and size is bounded by the provider contract.
    let result = unsafe { libc::ftruncate(fd, size) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn write_all(fd: RawFd, bytes: &[u8]) -> io::Result<()> {
    let mut written = 0_usize;
    while written < bytes.len() {
        let offset = libc::off_t::try_from(written)
            .map_err(|_| io::Error::from_raw_os_error(libc::EOVERFLOW))?;
        // SAFETY: the slice pointer and remaining length are valid for this pwrite call.
        let count = unsafe {
            libc::pwrite(
                fd,
                bytes[written..].as_ptr().cast(),
                bytes.len() - written,
                offset,
            )
        };
        if count < 0 {
            return Err(io::Error::last_os_error());
        }
        if count == 0 {
            return Err(io::Error::from_raw_os_error(libc::EIO));
        }
        written += usize::try_from(count).map_err(|_| io::Error::from_raw_os_error(libc::EIO))?;
    }
    Ok(())
}

fn read_all(fd: RawFd, bytes: &mut [u8]) -> io::Result<()> {
    let mut read = 0_usize;
    while read < bytes.len() {
        let offset = libc::off_t::try_from(read)
            .map_err(|_| io::Error::from_raw_os_error(libc::EOVERFLOW))?;
        // SAFETY: the mutable slice pointer and remaining length are valid for this pread call.
        let count = unsafe {
            libc::pread(
                fd,
                bytes[read..].as_mut_ptr().cast(),
                bytes.len() - read,
                offset,
            )
        };
        if count < 0 {
            return Err(io::Error::last_os_error());
        }
        if count == 0 {
            return Err(io::Error::from_raw_os_error(libc::EIO));
        }
        read += usize::try_from(count).map_err(|_| io::Error::from_raw_os_error(libc::EIO))?;
    }
    Ok(())
}

fn file_size(fd: &OwnedFd) -> io::Result<usize> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: `fd` is live and `stat` points to writable storage of the exact libc type.
    let result = unsafe { libc::fstat(fd.as_raw_fd(), stat.as_mut_ptr()) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: fstat initialized `stat` when it returned zero.
    let stat = unsafe { stat.assume_init() };
    usize::try_from(stat.st_size).map_err(|_| io::Error::from_raw_os_error(libc::EOVERFLOW))
}

fn probe_syscall(number: libc::c_long) -> bool {
    // SAFETY: invalid descriptors and a null path intentionally exercise syscall availability only.
    let result = unsafe { libc::syscall(number, -1, std::ptr::null::<libc::c_char>(), -1, 0) };
    result != -1 || io::Error::last_os_error().raw_os_error() != Some(libc::ENOSYS)
}

fn map_io_error(error: &io::Error, fallback: &str) -> Error {
    match error.raw_os_error() {
        Some(libc::EEXIST) => Error::from_reason("artifact_occupied"),
        Some(libc::ENOENT) => Error::from_reason("artifact_missing"),
        Some(libc::ELOOP | libc::EXDEV | libc::EINVAL | libc::ENOTDIR) => {
            Error::from_reason("artifact_path_invalid")
        }
        Some(libc::EBADF) => Error::from_reason("root_closed"),
        Some(libc::EACCES | libc::EPERM) => Error::from_reason("artifact_permission_denied"),
        _ => Error::from_reason(fallback),
    }
}

fn cleanup_status(error: &io::Error) -> Error {
    if error.raw_os_error() == Some(libc::EEXIST) {
        Error::from_reason("replacement_retained")
    } else {
        map_io_error(error, "artifact_cleanup_failed")
    }
}

fn into_owned_fd(file: std::fs::File) -> OwnedFd {
    let raw = file.into_raw_fd();
    // SAFETY: ownership of the file descriptor was transferred by forgetting the File.
    unsafe { OwnedFd::from_raw_fd(raw) }
}

#[cfg(test)]
mod tests {
    use super::{
        artifact_leaf, checked_syscall_fd, lease_leaf_from_path, probe_review_artifact_capabilities,
    };

    #[test]
    fn artifact_leaf_rejects_paths_outside_the_review_directory() {
        assert!(artifact_leaf(".justice/reviews/ok.json").is_ok());
        assert!(artifact_leaf("/tmp/ok.json").is_err());
        assert!(artifact_leaf(".justice/reviews/../ok.json").is_err());
        assert!(artifact_leaf(".justice/reviews/link.JSON").is_err());
    }

    #[test]
    fn lease_leaf_rejects_paths_outside_the_lease_directory() {
        assert!(lease_leaf_from_path(".justice/reviews/.leases/id.lease").is_ok());
        assert!(lease_leaf_from_path(".justice/reviews/id.lease").is_err());
        assert!(lease_leaf_from_path(".justice/reviews/.leases/../id.lease").is_err());
    }

    #[test]
    fn capability_probe_reports_the_supported_linux_build() {
        let capabilities = probe_review_artifact_capabilities();
        assert!(capabilities.linux);
        assert!(capabilities.x64);
        assert!(capabilities.glibc);
        assert!(capabilities.openat2);
        assert!(capabilities.renameat2);
    }

    #[test]
    fn checked_syscall_fd_rejects_values_outside_c_int() {
        let too_large = libc::c_long::try_from(i64::from(libc::c_int::MAX) + 1)
            .expect("Linux x64 c_long can represent c_int::MAX + 1");

        assert_eq!(
            checked_syscall_fd(too_large)
                .expect_err("out-of-range syscall result must fail")
                .raw_os_error(),
            Some(libc::EOVERFLOW)
        );
        assert_eq!(
            checked_syscall_fd(-1).expect("-1 is a valid syscall error result"),
            -1
        );
    }
}
