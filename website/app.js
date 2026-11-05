const english = document.documentElement.lang === "en";
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const code = document.getElementById(button.dataset.copy);
    const feedback = button.closest(".command").querySelector("[role=status]");
    try {
      await navigator.clipboard.writeText(code.textContent);
      feedback.textContent = english ? "Copied. Run it in your terminal." : "已复制，请在自己的终端运行。";
      button.textContent = english ? "Copied" : "已复制";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      code.focus();
      feedback.textContent = english ? "Select and copy this command manually." : "请选中命令后手动复制。";
    }
  });
}
const menu = document.querySelector("[data-menu]");
const navigation = document.getElementById("navigation");
function closeMenu() {
  menu.setAttribute("aria-expanded", "false");
  navigation.removeAttribute("data-open");
}
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  if (open) navigation.setAttribute("data-open", ""); else closeMenu();
});
navigation.addEventListener("click", event => { if (event.target.closest("a")) closeMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); });
