"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, EyeOff, GripVertical, PauseCircle, Plus } from "lucide-react";

import { cn } from "../../../lib/cn";
import type { FilterRule } from "../../../lib/types";
import { useAppStore } from "../../state/store";
import { Button, IconButton } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { BaseRuleList } from "./base-rule-list";
import { ruleSummary } from "./rule-summary";

const indexLabel = (rules: FilterRule[], id: string | number) => {
  const index = rules.findIndex((rule) => rule.id === id);
  return index < 0 ? "" : `第 ${index + 1} 位`;
};

function SortableRule({ rule, index, selected, onSelect }: {
  rule: FilterRule;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex items-stretch rounded-md border transition-colors duration-150",
        selected
          ? "border-gold/60 bg-gold/8 before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-gold"
          : "border-transparent hover:bg-surface-3/60",
        isDragging && "z-sticky border-gold/70 shadow-raised",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`调整规则「${rule.name}」的顺序`}
        className="grid w-7 shrink-0 cursor-grab place-items-center rounded-md text-ink-faint transition-colors hover:text-ink active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 py-2 pr-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs text-gold">{index + 1}</span>
          <span className={cn("min-w-0 flex-1 truncate font-medium", rule.enabled ? "text-ink" : "text-ink-faint line-through")}>
            {rule.name || "规则名称"}
          </span>
          {rule.hidden && (
            <Tooltip label="隐藏物品">
              <EyeOff aria-hidden="true" className="size-3.5 shrink-0 text-ember" />
            </Tooltip>
          )}
          {!rule.enabled && (
            <Tooltip label="已停用">
              <PauseCircle aria-hidden="true" className="size-3.5 shrink-0 text-ink-faint" />
            </Tooltip>
          )}
        </span>
        <span className="line-clamp-2 pl-7 text-xs leading-snug text-ink-muted">{ruleSummary(rule)}</span>
      </button>
    </li>
  );
}

/** 宽布局下的规则列表：拖动左侧手柄排序（键盘：空格拿起，上下键移动），上下按钮是等价的替代操作。 */
export function RuleList() {
  const rules = useAppStore((state) => state.profile.rules);
  const activeRuleId = useAppStore((state) => state.activeRuleId);
  const setActiveRuleId = useAppStore((state) => state.setActiveRuleId);
  const moveRule = useAppStore((state) => state.moveRule);
  const addRule = useAppStore((state) => state.addRule);
  const baseSelected = useAppStore((state) => state.activeBase !== null);
  const showBaseRules = useAppStore((state) => state.showBaseRules);
  const active = baseSelected ? undefined : rules.find((rule) => rule.id === activeRuleId) ?? rules[0];
  const index = active ? rules.indexOf(active) : -1;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => `拿起规则，${indexLabel(rules, dragged.id)}`,
    onDragOver: ({ active: dragged, over }) => (over ? `移动到第 ${rules.findIndex((rule) => rule.id === over.id) + 1} 位` : indexLabel(rules, dragged.id)),
    onDragEnd: ({ over }) => (over ? `规则现在排在第 ${rules.findIndex((rule) => rule.id === over.id) + 1} 位` : "顺序未改变"),
    onDragCancel: () => "已取消排序",
  };

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    if (!over || dragged.id === over.id) return;
    const from = rules.findIndex((rule) => rule.id === dragged.id);
    const to = rules.findIndex((rule) => rule.id === over.id);
    if (from >= 0 && to >= 0) moveRule(String(dragged.id), to - from);
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        accessibility={{
          screenReaderInstructions: { draggable: "按空格或回车拿起规则，用上下方向键移动，再按一次放下；Esc 取消。" },
          announcements,
        }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={rules.map((rule) => rule.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1" aria-label="规则顺序">
            {rules.map((rule, position) => (
              <SortableRule
                key={rule.id}
                rule={rule}
                index={position}
                selected={active?.id === rule.id}
                onSelect={() => setActiveRuleId(rule.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-1 border-t border-line pt-2">
        <IconButton label="上移当前规则" size="icon-sm" disabled={index <= 0} onClick={() => active && moveRule(active.id, -1)}>
          <ArrowUp aria-hidden="true" />
        </IconButton>
        <IconButton
          label="下移当前规则"
          size="icon-sm"
          disabled={index < 0 || index >= rules.length - 1}
          onClick={() => active && moveRule(active.id, 1)}
        >
          <ArrowDown aria-hidden="true" />
        </IconButton>
        <Button
          size="sm"
          className="ml-auto flex-1 border-dashed"
          disabled={rules.length >= 100}
          onClick={addRule}
        >
          <Plus aria-hidden="true" />
          新增规则
        </Button>
      </div>
      {showBaseRules && <BaseRuleList />}
    </div>
  );
}

/** 窄布局下的规则列表：一行可横向滚动的标签。 */
export function RuleStrip() {
  const rules = useAppStore((state) => state.profile.rules);
  const activeRuleId = useAppStore((state) => state.activeRuleId);
  const setActiveRuleId = useAppStore((state) => state.setActiveRuleId);
  const addRule = useAppStore((state) => state.addRule);
  const baseSelected = useAppStore((state) => state.activeBase !== null);
  const active = baseSelected ? undefined : rules.find((rule) => rule.id === activeRuleId) ?? rules[0];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label="规则列表">
      {rules.map((rule, index) => (
        <button
          key={rule.id}
          type="button"
          aria-pressed={active?.id === rule.id}
          onClick={() => setActiveRuleId(rule.id)}
          className={cn(
            "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors duration-150",
            active?.id === rule.id ? "border-gold/60 bg-gold/8 text-ink" : "border-line bg-surface-2 text-ink-muted hover:text-ink",
          )}
        >
          <span className="font-mono text-gold">{index + 1}</span>
          <span className="max-w-40 truncate">{rule.name || "规则名称"}</span>
          {rule.hidden && <EyeOff aria-hidden="true" className="size-3 shrink-0 text-ember" />}
          {!rule.enabled && <PauseCircle aria-hidden="true" className="size-3 shrink-0 text-ink-faint" />}
        </button>
      ))}
      <IconButton
        label="新增规则"
        variant="secondary"
        className="ml-1 border-dashed text-ink-muted"
        disabled={rules.length >= 100}
        onClick={addRule}
      >
        <Plus aria-hidden="true" />
      </IconButton>
    </div>
  );
}
