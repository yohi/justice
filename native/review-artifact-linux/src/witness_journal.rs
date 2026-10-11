use crate::{
    create_workspace_temporary, gate_lock_id, mkdir_relative, open_relative, rename_relative,
    unlink_relative,
};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, OwnedFd, RawFd};
use std::os::unix::fs::MetadataExt;

const DIRECTORY_FLAGS: libc::c_int =
    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

pub(crate) fn verify_namespace(root: RawFd) -> io::Result<()> {
    for entry in std::fs::read_dir(format!("/proc/self/fd/{root}"))? {
        let entry = entry?;
        let name = entry.file_name();
        if !["events", "locks", "recovery"]
            .iter()
            .any(|allowed| name == *allowed)
            || !entry.file_type()?.is_dir()
        {
            return Err(io::Error::from_raw_os_error(libc::EINVAL));
        }
    }
    Ok(())
}

fn directory(root: RawFd, path: &str) -> io::Result<OwnedFd> {
    open_relative(root, path, DIRECTORY_FLAGS, 0)
}

pub(crate) fn list(root: RawFd, path: &str, files: bool) -> io::Result<Vec<String>> {
    let dir = match directory(root, path) {
        Ok(dir) => dir,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut ids = Vec::new();
    for entry in std::fs::read_dir(format!("/proc/self/fd/{}", dir.as_raw_fd()))? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        if name.starts_with(".justice-replace-") {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() || (files && !kind.is_file()) || (!files && !kind.is_dir()) {
            return Err(io::Error::from_raw_os_error(libc::EINVAL));
        }
        let id = if files {
            name.strip_suffix(".jsonl")
                .ok_or_else(|| io::Error::from_raw_os_error(libc::EINVAL))?
        } else {
            &name
        };
        gate_lock_id(id).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        ids.push(id.to_owned());
    }
    ids.sort();
    Ok(ids)
}

pub(crate) fn read(root: RawFd, path: &str) -> io::Result<Option<Vec<u8>>> {
    let fd = match open_relative(
        root,
        path,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        0,
    ) {
        Ok(fd) => fd,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut file = File::from(fd);
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > 8 * 1024 * 1024 {
        return Err(io::Error::from_raw_os_error(libc::EINVAL));
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}

pub(crate) fn replace(
    root: RawFd,
    scope: &str,
    gate: &str,
    writer: &str,
    expected: Option<&str>,
    bytes: &[u8],
) -> io::Result<()> {
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(io::Error::from_raw_os_error(libc::EFBIG));
    }
    let mut parent = directory(root, "events")?;
    for id in [scope, gate] {
        mkdir_relative(parent.as_raw_fd(), id, 0o700)?;
        File::from(directory(parent.as_raw_fd(), ".")?).sync_all()?;
        parent = directory(parent.as_raw_fd(), id)?;
    }
    let leaf = format!("{writer}.jsonl");
    let prior = read(parent.as_raw_fd(), &leaf)?;
    let prior_digest = prior
        .as_ref()
        .map(|prior| format!("{:x}", Sha256::digest(prior)));
    if prior_digest.as_deref() != expected {
        return Err(io::Error::from_raw_os_error(libc::ESTALE));
    }
    let (temporary, fd) = create_workspace_temporary(parent.as_raw_fd())?;
    let mut file = File::from(fd);
    let result = (|| -> io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        if read(parent.as_raw_fd(), &leaf)? != prior {
            return Err(io::Error::from_raw_os_error(libc::ESTALE));
        }
        rename_relative(parent.as_raw_fd(), &temporary, parent.as_raw_fd(), &leaf, 0)?;
        File::from(directory(parent.as_raw_fd(), ".")?).sync_all()
    })();
    if result.is_err() && read(parent.as_raw_fd(), &temporary)?.is_some() {
        unlink_relative(parent.as_raw_fd(), &temporary)?;
    }
    result
}
