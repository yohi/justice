import type { PlanTask, PlanStep, PlanTaskStatus } from "./types";

const TASK_HEADING_REGEX = /^###\s+Task\s+(\d+):\s*(.+)$/;
const CHECKBOX_ANY_REGEX = /^-\s+\[([ x])\]\s+(.+)$/;

export class PlanParser {
  /**
   * Parse plan.md content into structured PlanTask array.
   */
  parse(content: string): PlanTask[] {
    if (!content.trim()) return [];

    const lines = content.split("\n");
    const tasks: PlanTask[] = [];
    let currentTask: { title: string; taskNum: number; steps: PlanStep[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      
      const lineNumber = i + 1; // 1-indexed

      const taskMatch = line.match(TASK_HEADING_REGEX);
      if (taskMatch && taskMatch[1] !== undefined && taskMatch[2] !== undefined) {
        if (currentTask) {
          tasks.push(this.buildTask(currentTask));
        }
        currentTask = {
          taskNum: parseInt(taskMatch[1], 10),
          title: taskMatch[2].trim(),
          steps: [],
        };
        continue;
      }

      if (currentTask) {
        const checkboxMatch = line.match(CHECKBOX_ANY_REGEX);
        if (checkboxMatch && checkboxMatch[1] !== undefined && checkboxMatch[2] !== undefined) {
          const stepNum = currentTask.steps.length + 1;
          currentTask.steps.push({
            id: `task-${currentTask.taskNum}-step-${stepNum}`,
            description: checkboxMatch[2].trim(),
            checked: checkboxMatch[1] === "x",
            lineNumber,
          });
        }
      }
    }

    if (currentTask) {
      tasks.push(this.buildTask(currentTask));
    }

    return tasks;
  }

  /**
   * Update a checkbox at a specific line number.
   */
  updateCheckbox(content: string, lineNumber: number, checked: boolean): string {
    const lines = content.split("\n");
    const index = lineNumber - 1;

    if (index < 0 || index >= lines.length) {
      throw new Error(`Line number ${lineNumber} is out of range (1-${lines.length})`);
    }

    const line = lines[index];
    if (line === undefined || !CHECKBOX_ANY_REGEX.test(line)) {
      throw new Error(`Line ${lineNumber} is not a checkbox: "${line}"`);
    }

    if (checked) {
      lines[index] = line.replace("- [ ]", "- [x]");
    } else {
      lines[index] = line.replace("- [x]", "- [ ]");
    }

    return lines.join("\n");
  }

  /**
   * Append an error note after a specific task heading.
   */
  appendErrorNote(content: string, taskId: string, errorMessage: string): string {
    const taskNum = parseInt(taskId.replace("task-", ""), 10);
    const lines = content.split("\n");
    const result: string[] = [];
    let inserted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined) {
        result.push(line);
      }

      if (!inserted && line !== undefined) {
        const taskMatch = line.match(TASK_HEADING_REGEX);
        if (taskMatch && taskMatch[1] !== undefined && parseInt(taskMatch[1], 10) === taskNum) {
          result.push("");
          result.push(`> ⚠️ **Error**: ${errorMessage}`);
          result.push("");
          inserted = true;
        }
      }
    }

    return result.join("\n");
  }

  /**
   * Get the next incomplete task (first non-completed task).
   */
  getNextIncompleteTask(tasks: PlanTask[]): PlanTask | undefined {
    return tasks.find((t) => t.status !== "completed");
  }

  private buildTask(raw: { title: string; taskNum: number; steps: PlanStep[] }): PlanTask {
    return {
      id: `task-${raw.taskNum}`,
      title: raw.title,
      steps: raw.steps,
      status: this.deriveStatus(raw.steps),
    };
  }

  private deriveStatus(steps: PlanStep[]): PlanTaskStatus {
    if (steps.length === 0) return "pending";

    const checkedCount = steps.filter((s) => s.checked).length;

    if (checkedCount === steps.length) return "completed";
    if (checkedCount > 0) return "in_progress";
    return "pending";
  }
}