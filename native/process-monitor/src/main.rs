use std::collections::HashMap;
use std::io::{self, BufRead, Write};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sample {
    processors: usize,
    processes: Vec<ProcessSample>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSample {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    command: Vec<String>,
    cpu: f32,
    memory: u64,
    started_at: u64,
}

#[derive(Clone, Copy)]
struct Entry {
    pid: u32,
    parent_pid: Option<u32>,
    started_at: u64,
}

fn main() -> io::Result<()> {
    let root = std::env::args()
        .nth(1)
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "usage: rebase-process-monitor <root-pid>",
            )
        })?;
    let mut system = System::new();
    refresh(&mut system);
    let mut output = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        line?;
        refresh(&mut system);
        serde_json::to_writer(&mut output, &sample(&system, root))?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}

fn refresh(system: &mut System) {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .without_tasks(),
    );
}

fn sample(system: &System, root: u32) -> Sample {
    let entries: Vec<Entry> = system
        .processes()
        .values()
        .map(|process| Entry {
            pid: process.pid().as_u32(),
            parent_pid: process.parent().map(Pid::as_u32),
            started_at: process.start_time(),
        })
        .collect();
    let processes = descendants(&entries, root)
        .into_iter()
        .filter_map(|pid| system.process(Pid::from_u32(pid)))
        .map(|process| ProcessSample {
            pid: process.pid().as_u32(),
            parent_pid: process.parent().map(Pid::as_u32),
            name: process.name().to_string_lossy().into_owned(),
            command: process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy().into_owned())
                .collect(),
            cpu: process.cpu_usage(),
            memory: process.memory(),
            started_at: process.start_time() * 1_000,
        })
        .collect();
    Sample {
        processors: std::thread::available_parallelism().map_or(1, usize::from),
        processes,
    }
}

fn descendants(entries: &[Entry], root: u32) -> Vec<u32> {
    let Some(root_entry) = entries.iter().find(|entry| entry.pid == root) else {
        return Vec::new();
    };
    let mut children: HashMap<u32, Vec<Entry>> = HashMap::new();
    for entry in entries {
        if let Some(parent) = entry.parent_pid
            && parent != entry.pid
        {
            children.entry(parent).or_default().push(*entry);
        }
    }
    let mut found = vec![root];
    let mut pending = vec![*root_entry];
    while let Some(parent) = pending.pop() {
        for child in children.get(&parent.pid).into_iter().flatten() {
            if child.started_at >= parent.started_at && !found.contains(&child.pid) {
                found.push(child.pid);
                pending.push(*child);
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(pid: u32, parent_pid: Option<u32>, started_at: u64) -> Entry {
        Entry {
            pid,
            parent_pid,
            started_at,
        }
    }

    #[test]
    fn collects_the_root_and_every_descendant() {
        let entries = [
            entry(1, None, 0),
            entry(10, Some(1), 5),
            entry(20, Some(10), 6),
            entry(21, Some(20), 7),
            entry(30, Some(1), 8),
        ];

        let mut found = descendants(&entries, 10);
        found.sort();

        assert_eq!(found, vec![10, 20, 21]);
    }

    #[test]
    fn skips_children_that_started_before_their_parent() {
        let entries = [
            entry(10, None, 50),
            entry(20, Some(10), 40),
            entry(30, Some(10), 60),
        ];

        assert_eq!(descendants(&entries, 10), vec![10, 30]);
    }

    #[test]
    fn returns_nothing_when_the_root_is_gone() {
        assert!(descendants(&[entry(20, Some(10), 1)], 10).is_empty());
    }

    #[test]
    fn samples_a_child_process_with_its_command() {
        let mut child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sleep" })
            .args(if cfg!(windows) {
                vec!["/c", "ping", "-n", "30", "127.0.0.1"]
            } else {
                vec!["30"]
            })
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("spawn child");
        let mut system = System::new();
        refresh(&mut system);

        let sampled = sample(&system, std::process::id());
        child.kill().ok();
        child.wait().ok();

        let found = sampled
            .processes
            .iter()
            .find(|process| process.pid == child.id())
            .expect("child sampled");
        assert_eq!(found.parent_pid, Some(std::process::id()));
        assert!(!found.command.is_empty());
        assert!(
            sampled
                .processes
                .iter()
                .any(|process| process.pid == std::process::id() && process.memory > 0)
        );
    }
}
