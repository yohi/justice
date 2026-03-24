import type { PlanTask, PlanStep, PlanTaskStatus } from "./types";

const TASK_HEADING_REGEX = /^#{2,3}\s+Task\s+(\d+):\s*(.+)$/;
const CHECKBOX_ANY_REGEX = /^(\s*-\s+\[)([ xX])(\]\s+.+)$/;

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
        if (checkboxMatch && checkboxMatch[2] !== undefined && checkboxMatch[3] !== undefined) {
          const stepNum = currentTask.steps.length + 1;
          currentTask.steps.push({
            id: `task-${currentTask.taskNum}-step-${stepNum}`,
            description: checkboxMatch[3].replace(/^\]\s+/, "").trim(),
            checked: checkboxMatch[2].toLowerCase() === "x",
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
    if (line === undefined) {
      throw new Error(`Line number ${lineNumber} is undefined`);
    }

    const match = line.match(CHECKBOX_ANY_REGEX);
    if (!match || match[1] === undefined || match[3] === undefined) {
      throw new Error(`Line ${lineNumber} is not a checkbox: "${line}"`);
    }

    const newChar = checked ? "x" : " ";
    lines[index] = `${match[1]}${newChar}${match[3]}`;

    return lines.join("\n");
  }

  /**
   * Append an error note after a specific task heading.
   */
  appendErrorNote(content: string, taskId: string, errorMessage: string): string {
    const idMatch = taskId.match(/^task-(\d+)$/);
    if (!idMatch || idMatch[1] === undefined) {
      throw new Error(`Invalid taskId format: ${taskId}`);
    }
    const taskNum = parseInt(idMatch[1], 10);
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
