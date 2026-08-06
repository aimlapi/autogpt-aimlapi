"use client";

import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/molecules/Form/Form";

import { useApiKeyConnectForm } from "./useApiKeyConnectForm";

interface Props {
  provider: string;
  providerName: string;
  onSuccess: () => void;
}

export function ApiKeyConnectForm({
  provider,
  providerName,
  onSuccess,
}: Props) {
  const isAimlapi = provider === "aiml_api";
  const { form, handleSubmit, isPending, getApiKey, oauthStatus, oauthMessage } =
    useApiKeyConnectForm({
      provider,
      defaultTitle: isAimlapi ? `My ${providerName} key` : undefined,
      onSuccess,
    });

  return (
    <Form form={form} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                {...field}
                id={field.name}
                autoComplete="off"
                label="Name"
                placeholder={`My ${providerName} key`}
                wrapperClassName="!mb-0"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="apiKey"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              {isAimlapi ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <Input
                        {...field}
                        id={field.name}
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        label="API key"
                        placeholder="sk-..."
                        hint="Have a key? Paste it here."
                        wrapperClassName="!mb-0"
                      />
                    </div>
                    <span className="pt-9 text-sm text-zinc-400">or</span>
                    <div className="flex flex-col items-center gap-1 pt-[1.65rem]">
                      <Button
                        type="button"
                        variant="primary"
                        size="large"
                        onClick={getApiKey}
                        loading={oauthStatus === "authorizing"}
                        disabled={oauthStatus === "authorizing"}
                      >
                        Get API key
                      </Button>
                      <span className="text-xs text-zinc-500">
                        Continue with aimlapi.com
                      </span>
                    </div>
                  </div>
                  {oauthStatus === "success" && oauthMessage ? (
                    <p className="text-sm font-medium text-green-600">
                      {oauthMessage}
                    </p>
                  ) : null}
                  {oauthStatus === "error" && oauthMessage ? (
                    <p className="text-sm font-medium text-red-600">
                      {oauthMessage}
                    </p>
                  ) : null}
                </div>
              ) : (
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  label="API key"
                  placeholder="sk-..."
                  wrapperClassName="!mb-0"
                />
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="expiresAt"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                id={field.name}
                type="date"
                label="Expires (optional)"
                hint="Leave blank to keep the key indefinitely"
                wrapperClassName="!mb-0"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <Button
        type="submit"
        variant="primary"
        size="large"
        disabled={!form.formState.isValid || isPending}
        loading={isPending}
      >
        Save API key
      </Button>
    </Form>
  );
}
