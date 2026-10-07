import SwiftUI

struct WorkspaceProcess: Identifiable {
    var id: String
    var title: String
    var detail: String?
    var state: (label: String, tone: AgentTone)
}

func runState(_ terminal: RunTerminal?) -> (label: String, tone: AgentTone) {
    switch terminal?.status {
    case nil: ("Not running", .quiet)
    case "running": (terminal?.activity == "busy" ? "Busy" : "Running", .live)
    case "ready": ("Ready", .done)
    case "failed": ("Failed", .danger)
    case "exited": ("Exited", .quiet)
    default: ("Closed", .quiet)
    }
}

func workspaceProcesses(configs: [RunConfiguration], terminals: [RunTerminal], backgroundTasks: Int?) -> [WorkspaceProcess] {
    var out = configs.map { config in
        WorkspaceProcess(id: "config:\(config.id)", title: config.name, detail: config.command,
                         state: runState(terminals.first { $0.configId == config.id }))
    }
    let saved = Set(configs.map(\.id))
    for terminal in terminals where terminal.isOpen && !saved.contains(terminal.configId ?? "") {
        out.append(WorkspaceProcess(id: "terminal:\(terminal.id)", title: terminal.title, detail: terminal.command,
                                    state: runState(terminal)))
    }
    if let tasks = backgroundTasks, tasks > 0 {
        out.append(WorkspaceProcess(id: "background", title: "Background tasks",
                                    detail: tasks == 1 ? "1 task still working" : "\(tasks) tasks still working",
                                    state: ("Working", .live)))
    }
    return out
}

struct WorkspaceSection: View {
    let session: Session
    let diff: SessionDiff?
    let processes: [WorkspaceProcess]

    var body: some View {
        let worktree = session.workspace.mode == "worktree"
        let path = session.workspace.path ?? diff?.workspacePath
        AgentSection(label: "Workspace", count: nil) {
            AgentRow(
                title: path.map { URL(fileURLWithPath: $0).lastPathComponent } ?? (worktree ? "Own worktree" : "Project checkout"),
                detail: path,
                state: (worktree ? "Worktree" : "Checkout", .quiet),
                activity: nil, open: nil, last: processes.isEmpty
            )
            ForEach(processes) { process in
                AgentRow(title: process.title, detail: process.detail, state: process.state,
                         activity: nil, open: nil, last: process.id == processes.last?.id)
            }
        }
    }
}

struct VersionControlSection: View {
    let branch: String?
    let diff: SessionDiff?

    var body: some View {
        let changes = diff?.repository == true ? diff : nil
        AgentSection(label: "Version control", count: nil) {
            FactRow(label: "Branch", last: changes == nil) {
                FactValue(text: branch ?? "Detached", mono: true)
            }
            if let changes {
                FactRow(label: "Changes", last: true) {
                    DiffCounts(added: changes.linesAdded, removed: changes.linesRemoved)
                    Spacer(minLength: 0)
                    DiffStatBar(added: changes.linesAdded, removed: changes.linesRemoved)
                }
            }
        }
    }
}
