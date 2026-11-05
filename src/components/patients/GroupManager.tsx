"use client";

/** グループの追加・名前変更・削除。患者そのものは消えない（削除すると、その患者は別のグループか「未分類」になる） */
import { useState, type FormEvent } from "react";
import { deleteGroup, upsertGroup, type Group, type PatientStore } from "@/lib/patients";
import { newGroupId } from "@/lib/ui/patient-bridge";
import { Button, inputClass } from "../ui";

function GroupRow({
  group,
  memberCount,
  otherNames,
  onRename,
  onDelete,
}: {
  group: Group;
  memberCount: number;
  otherNames: readonly string[];
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const trimmed = name.trim();
  const duplicated = otherNames.includes(trimmed);
  const canRename = trimmed !== "" && trimmed !== group.name && !duplicated;

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (canRename) onRename(trimmed);
  }

  return (
    <li className="rounded-xl border-2 border-line bg-raised p-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`グループ「${group.name}」の名前`}
          className={`${inputClass} flex-1 basis-48`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="text-ink">{memberCount}人</span>
        <Button type="submit" disabled={!canRename}>
          名前を変更
        </Button>
        <Button variant="danger" onClick={onDelete}>
          削除
        </Button>
      </form>
      {duplicated ? <p className="mt-1 font-bold text-akane">同じ名前のグループがあります。</p> : null}
    </li>
  );
}

export function GroupManager({
  store,
  onStoreChange,
  onClose,
}: {
  store: PatientStore;
  onStoreChange: (next: PatientStore) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const trimmed = newName.trim();
  const duplicated = store.groups.some((g) => g.name === trimmed);

  function add(e: FormEvent): void {
    e.preventDefault();
    if (trimmed === "" || duplicated) return;
    const group: Group = {
      id: newGroupId(),
      name: trimmed,
      sortMode: "kana",
      manualOrder: [],
      createdAt: new Date().toISOString(),
    };
    onStoreChange(upsertGroup(store, group));
    setNewName("");
  }

  function remove(group: Group): void {
    if (!window.confirm(`グループ「${group.name}」を削除します。患者は削除されません。よろしいですか？`)) return;
    onStoreChange(deleteGroup(store, group.id));
  }

  return (
    <div className="mt-4 rounded-xl border-2 border-line bg-surface p-3 sm:p-4" aria-label="グループの管理">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-bold">グループを管理</h3>
        <Button onClick={onClose}>閉じる</Button>
      </div>

      {store.groups.length === 0 ? (
        <p className="mb-3 text-ink">グループはまだありません。下の欄から作れます（例: 月曜の訪問、○○施設）。</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {store.groups.map((g) => (
            <GroupRow
              key={`${g.id}:${g.name}`}
              group={g}
              memberCount={store.patients.filter((p) => p.groupIds.includes(g.id)).length}
              otherNames={store.groups.filter((x) => x.id !== g.id).map((x) => x.name)}
              onRename={(name) => onStoreChange(upsertGroup(store, { ...g, name }))}
              onDelete={() => remove(g)}
            />
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="新しいグループの名前"
          placeholder="新しいグループの名前"
          className={`${inputClass} flex-1 basis-48`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={trimmed === "" || duplicated}>
          ＋ グループを追加
        </Button>
      </form>
      {duplicated ? <p className="mt-1 font-bold text-akane">同じ名前のグループがあります。</p> : null}
      <p className="mt-3 text-ink">
        患者をグループに入れるには、患者を選んで「この患者を編集」を開き、「グループ」にチェックを入れて保存します。
      </p>
    </div>
  );
}
