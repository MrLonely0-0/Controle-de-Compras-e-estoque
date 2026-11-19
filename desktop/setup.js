const form = document.querySelector("form");
const button = document.querySelector("button");
const status = document.querySelector("#status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "Verificando o servidor…";
  try {
    await window.estoqueSetup.save(document.querySelector("#url").value);
  } catch (e) {
    status.textContent = e.message.replace(/^.*Error: /, "");
    button.disabled = false;
  }
});
