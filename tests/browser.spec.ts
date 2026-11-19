import { test, expect } from "@playwright/test";

test("dashboard, PWA sem rede, cálculo de carrinho e navegação mobile", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Olá, Camila!" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Sem conexão", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Abrir lista de compras" }).click();
  await page
    .getByRole("button", { name: "Adicionar", exact: true })
    .first()
    .click();
  await page.getByLabel(/Quantidade pega/).fill("2");
  await page.getByLabel("Preço total (R$)").fill("10,00");
  await expect(page.getByLabel("Preço unitário (R$)")).toHaveValue("5,00");
  await page
    .getByRole("button", { name: "Adicionar ao carrinho", exact: true })
    .click();
  await page.getByRole("button", { name: "Carrinho 1" }).click();
  await page.getByRole("button", { name: "Remover item" }).click();
  await expect(page.getByText("Seu carrinho está vazio.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Olá, Camila!" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("enfileira requisição offline e sincroniza na reconexão", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByText("Em tempo real", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Ações de Filé de frango" }).click();
  await page
    .getByRole("button", { name: "Comprar esse item", exact: true })
    .click();
  await page.getByLabel("Observações").fill("Requisição feita sem sinal");
  await page.getByRole("button", { name: "Enviar para compras" }).click();
  await expect(page.getByText(/1 alteração\(ões\) aguardando/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/1 alteração\(ões\) aguardando/)).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir lista de compras" }).click();
  await expect(
    page.getByText("Requisição feita sem sinal", { exact: true }),
  ).toBeVisible();
});
