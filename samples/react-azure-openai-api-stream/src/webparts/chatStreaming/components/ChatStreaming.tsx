import * as React from 'react';
//import styles from './ChatStreaming.module.scss';
import type { IChatStreamingProps } from './IChatStreamingProps';
import { IChatStreamingState } from './IChatStreamingState';
import { cloneDeep } from '@microsoft/sp-lodash-subset';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import CompletionsRequestBuilder from '../models/CompletionsRequestBuilder';
import { Spinner, SpinnerSize, Stack } from '@fluentui/react';
import MessagesList from './MessagesList';
import UserMessage from './UserMessage';
import { IChatMessage } from '../models/IChatMessage';
//import { ICompletionsRequest } from '../Models/ICompletionsRequest';

export default class ChatStreaming extends React.Component<IChatStreamingProps, IChatStreamingState> {

  private _signal: AbortSignal;
  private _controller: AbortController;

  constructor(props: IChatStreamingProps) {
    super(props);

    this.state = {
      userQuery: '',
      sessionMessages: [],
      thinking: false
    }

    this._controller = new AbortController();
    this._signal = this._controller.signal;
  }

  public render(): React.ReactElement<IChatStreamingProps> {

    const content = this._validateWebPartProperties() ? (
      <Stack tokens={{ childrenGap: 20 }} style={{ minHeight: "100%" }}>
        <Stack.Item
          grow={1}
          styles={{
            root: { minHeight: "200px", height: "100%", position: "relative" },
          }}
        >
          <MessagesList messages={this.state.sessionMessages} />
        </Stack.Item>
        {this.state.thinking && (
          <Stack.Item>
            <Spinner
              size={SpinnerSize.large}
              label="Wait till our super cool AI system answers your question..."
              ariaLive="assertive"
              labelPosition="right"
            />
          </Stack.Item>
        )}
        <Stack.Item>
          <UserMessage
            textFieldValue={this.state.userQuery}
            onMessageChange={this._onUserQueryChange}
            sendQuery={this._onQuerySent}
            controller={this._controller}
          />
        </Stack.Item>
      </Stack>
    ) : (
      <div>Please configure the OpenAI API settings in Webpart panel</div>
    );

    return (
      content
    );
  }

  private _onQuerySent = async (): Promise<void> => {
    this.setState({
      thinking: true
    });

    this.state.sessionMessages.push({
      role: 'user', text: this.state.userQuery
    });

    await this._chatAsStream();

    this.setState({
      thinking: false
    });
  }

  private _onUserQueryChange = (newQuery: string): void => {
    this.setState({
      userQuery: newQuery
    });
  }

  private _chatAsStream = async (): Promise<void> => {

    const openAiApiOptions = this.props.openApiOptions;
    const endpoint: string = `${openAiApiOptions.endpoint}/openai/deployments/${openAiApiOptions.deploymentName}/chat/completions?api-version=2023-06-01-preview`;

    const setStreamChunk = (text: string): void => {
      const currentChatGptMessages: IChatMessage[] = cloneDeep(this.state.sessionMessages);
      if (text !== undefined && text !== null && text.length > 0) {
        const lastSessionMessage = currentChatGptMessages[currentChatGptMessages.length - 1];

        if (lastSessionMessage.role === 'user') {
          currentChatGptMessages.push({
            role: 'assistant',
            text: text
          });
        } else {
          lastSessionMessage.text += text;
        }

        this.setState({
          sessionMessages: currentChatGptMessages,
          thinking: false,
          userQuery: ''
        });
      }
    };

    const requestBuilder: CompletionsRequestBuilder = new CompletionsRequestBuilder();
    this.state.sessionMessages.map(m => {
        if (m.role === 'assistant') {
            requestBuilder.addAssistantMessage(m.text);
        } else {
            requestBuilder.addUserMessage(m.text);
        }
    });

    await fetchEventSource(endpoint, {
      method: "POST",
      headers: {
        "Accept": "text/event-stream",
        "Content-type": "application/json",
        "api-key": openAiApiOptions.apiKey
      },
      body: requestBuilder.buildAsJson(),
      async onopen(res) {
        console.log(res);
      },
      onmessage(event) {
        //console.log(event.data);
        if (event.data === "[DONE]") {
          console.log("Stream done");
          return;
        }
        const data = JSON.parse(event.data);
        const text: string =
          data.choices && data.choices.length > 0 && data.choices[0] && data.choices[0].delta ?
            data.choices[0].delta.content
          : '';
        setStreamChunk(text);
        //console.log(text);
      },
      onclose() {
        console.log("Connection closed by the server");
      },
      onerror(err) {
        console.log("There was an error from server", err);
      },
      signal: this._signal
    });
  }

  private _validateWebPartProperties(): boolean {
    if (!this.props.openApiOptions.apiKey) {
      return false;
    }

    if (!this.props.openApiOptions.endpoint) {
      return false;
    }

    if (!this.props.openApiOptions.deploymentName) {
      return false;
    }

    return true;
  }
}
