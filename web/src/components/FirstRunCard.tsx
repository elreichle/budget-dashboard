/** Shown on the Overview while `/api/plan` reports no plan file. */
export function FirstRunCard({ path, hint }: { path: string; hint: string }) {
  return (
    <section className="card first-run" aria-labelledby="first-run-title">
      <h2 id="first-run-title">Welcome! Let's set up your plan</h2>
      <p>The dashboard reads your budget from a plan file that lives outside the repository, so your numbers never end up in git.</p>
      <ol>
        <li>
          Copy <code>data/plan.example.json</code> from the repository to <code>{path}</code>.
        </li>
        <li>Open the copy and replace the sample buckets, savings goals and debts with your own.</li>
        <li>Reload this page. Edits are picked up without restarting the server.</li>
      </ol>
      <p className="muted">{hint}</p>
    </section>
  );
}
