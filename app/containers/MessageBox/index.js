import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
	View, FlatList, Text, TouchableOpacity, Alert
} from 'react-native';
import { connect } from 'react-redux';
import { emojify } from 'react-emojione';
import { KeyboardAccessoryView } from 'react-native-keyboard-input';
import ImagePicker from 'react-native-image-crop-picker';
import equal from 'deep-equal';

import { userTyping as userTypingAction } from '../../actions/room';
import {
	editRequest as editRequestAction,
	editCancel as editCancelAction,
	replyCancel as replyCancelAction
} from '../../actions/messages';
import RocketChat from '../../lib/rocketchat';
import styles from './styles';
import database from '../../lib/realm';
import Avatar from '../Avatar';
import CustomEmoji from '../EmojiPicker/CustomEmoji';
import { emojis } from '../../emojis';
import Recording from './Recording';
import FilesActions from './FilesActions';
import UploadModal from './UploadModal';
import './EmojiKeyboard';
import log from '../../utils/log';
import I18n from '../../i18n';
import ReplyPreview from './ReplyPreview';
import debounce from '../../utils/debounce';
import MessageBoxContent from './MessageBoxContent';
import { isIOS } from '../../utils/deviceInfo';

const MENTIONS_TRACKING_TYPE_USERS = '@';
const MENTIONS_TRACKING_TYPE_EMOJIS = ':';

const onlyUnique = function onlyUnique(value, index, self) {
	return self.indexOf(({ _id }) => value._id === _id) === index;
};

const imagePickerConfig = {
	cropping: true,
	compressImageQuality: 0.8,
	avoidEmptySpaceAroundImage: false,
	cropperChooseText: I18n.t('Choose'),
	cropperCancelText: I18n.t('Cancel')
};

class MessageBox extends Component {
	static propTypes = {
		rid: PropTypes.string.isRequired,
		baseUrl: PropTypes.string.isRequired,
		message: PropTypes.object,
		replyMessage: PropTypes.object,
		replying: PropTypes.bool,
		editing: PropTypes.bool,
		user: PropTypes.shape({
			id: PropTypes.string,
			username: PropTypes.string,
			token: PropTypes.string
		}),
		roomType: PropTypes.string,
		editCancel: PropTypes.func.isRequired,
		editRequest: PropTypes.func.isRequired,
		onSubmit: PropTypes.func.isRequired,
		typing: PropTypes.func,
		closeReply: PropTypes.func
	}

	constructor(props) {
		super(props);
		this.state = {
			mentions: [],
			showEmojiKeyboard: false,
			showFilesAction: false,
			showSend: false,
			recording: false,
			trackingType: '',
			file: {
				isVisible: false
			}
		};
		this.users = [];
		this.rooms = [];
		this.emojis = [];
		this.customEmojis = [];
		this.onEmojiSelected = this.onEmojiSelected.bind(this);
		this.text = '';
	}

	componentDidMount() {
		const { rid } = this.props;
		const [room] = database.objects('subscriptions').filtered('rid = $0', rid);
		if (room.draftMessage && room.draftMessage !== '') {
			this.setInput(room.draftMessage);
			this.setShowSend(true);
		}
	}

	componentWillReceiveProps(nextProps) {
		const { message, replyMessage } = this.props;
		if (message !== nextProps.message && nextProps.message.msg) {
			this.setInput(nextProps.message.msg);
			if (this.text) {
				this.setShowSend(true);
			}
			this.focus();
		} else if (replyMessage !== nextProps.replyMessage && nextProps.replyMessage.msg) {
			this.focus();
		} else if (!nextProps.message) {
			this.clearInput();
		}
	}

	shouldComponentUpdate(nextProps, nextState) {
		const {
			showEmojiKeyboard, showFilesAction, showSend, recording, mentions, file
		} = this.state;
		const {
			roomType, replying, editing
		} = this.props;
		if (nextProps.roomType !== roomType) {
			return true;
		}
		if (nextProps.replying !== replying) {
			return true;
		}
		if (nextProps.editing !== editing) {
			return true;
		}
		if (nextState.showEmojiKeyboard !== showEmojiKeyboard) {
			return true;
		}
		if (nextState.showFilesAction !== showFilesAction) {
			return true;
		}
		if (nextState.showSend !== showSend) {
			return true;
		}
		if (nextState.recording !== recording) {
			return true;
		}
		if (!equal(nextState.mentions, mentions)) {
			return true;
		}
		if (!equal(nextState.file, file)) {
			return true;
		}
		return false;
	}

	onChangeText = (text) => {
		const isTextEmpty = text.length === 0;
		this.setShowSend(!isTextEmpty);
		this.handleTyping(!isTextEmpty);
		this.debouncedOnChangeText(text);
	}

	// eslint-disable-next-line react/sort-comp
	debouncedOnChangeText = debounce((text) => {
		this.setInput(text);

		if (this.component) {
			requestAnimationFrame(() => {
				const { start, end } = this.component._lastNativeSelection;
				const cursor = Math.max(start, end);
				const lastNativeText = this.component._lastNativeText;
				const regexp = /(#|@|:)([a-z0-9._-]+)$/im;
				const result = lastNativeText.substr(0, cursor).match(regexp);
				if (!result) {
					return this.stopTrackingMention();
				}
				const [, lastChar, name] = result;
				this.identifyMentionKeyword(name, lastChar);
			});
		}
	}, 100);

	onKeyboardResigned = () => {
		this.closeEmoji();
	}

	onPressMention = (item) => {
		if (!this.component) {
			return;
		}
		const { trackingType } = this.state;
		const msg = this.text;
		const { start, end } = this.component._lastNativeSelection;
		const cursor = Math.max(start, end);
		const regexp = /([a-z0-9._-]+)$/im;
		const result = msg.substr(0, cursor).replace(regexp, '');
		const mentionName = trackingType === MENTIONS_TRACKING_TYPE_EMOJIS
			? `${ item.name || item }:`
			: (item.username || item.name);
		const text = `${ result }${ mentionName } ${ msg.slice(cursor) }`;
		this.setInput(text);
		this.focus();
		requestAnimationFrame(() => this.stopTrackingMention());
	}

	onEmojiSelected = (keyboardId, params) => {
		const { text } = this;
		const { emoji } = params;
		let newText = '';

		// if messagebox has an active cursor
		if (this.component && this.component._lastNativeSelection) {
			const { start, end } = this.component._lastNativeSelection;
			const cursor = Math.max(start, end);
			newText = `${ text.substr(0, cursor) }${ emoji }${ text.substr(cursor) }`;
		} else {
			// if messagebox doesn't have a cursor, just append selected emoji
			newText = `${ text }${ emoji }`;
		}
		this.setInput(newText);
		this.setShowSend(true);
	}

	getPermalink = async(message) => {
		try {
			return await RocketChat.getPermalink(message);
		} catch (error) {
			return null;
		}
	}

	getFixedMentions = (keyword) => {
		if ('all'.indexOf(keyword) !== -1) {
			this.users = [{ _id: -1, username: 'all' }, ...this.users];
		}
		if ('here'.indexOf(keyword) !== -1) {
			this.users = [{ _id: -2, username: 'here' }, ...this.users];
		}
	}

	getUsers = async(keyword) => {
		this.users = database.objects('users');
		if (keyword) {
			this.users = this.users.filtered('username CONTAINS[c] $0', keyword);
		}
		this.getFixedMentions(keyword);
		this.setState({ mentions: this.users.slice() });

		const usernames = [];

		if (keyword && this.users.length > 7) {
			return;
		}

		this.users.forEach(user => usernames.push(user.username));

		if (this.oldPromise) {
			this.oldPromise();
		}
		try {
			const results = await Promise.race([
				RocketChat.spotlight(keyword, usernames, { users: true }),
				new Promise((resolve, reject) => (this.oldPromise = reject))
			]);
			if (results.users && results.users.length) {
				database.write(() => {
					results.users.forEach((user) => {
						try {
							database.create('users', user, true);
						} catch (e) {
							log('create users', e);
						}
					});
				});
			}
		} catch (e) {
			console.warn('spotlight canceled');
		} finally {
			delete this.oldPromise;
			this.users = database.objects('users').filtered('username CONTAINS[c] $0', keyword).slice();
			this.getFixedMentions(keyword);
			this.setState({ mentions: this.users });
		}
	}

	getRooms = async(keyword = '') => {
		this.roomsCache = this.roomsCache || [];
		this.rooms = database.objects('subscriptions')
			.filtered('t != $0', 'd');
		if (keyword) {
			this.rooms = this.rooms.filtered('name CONTAINS[c] $0', keyword);
		}

		const rooms = [];
		this.rooms.forEach(room => rooms.push(room));

		this.roomsCache.forEach((room) => {
			if (room.name && room.name.toUpperCase().indexOf(keyword.toUpperCase()) !== -1) {
				rooms.push(room);
			}
		});

		if (rooms.length > 3) {
			this.setState({ mentions: rooms });
			return;
		}

		if (this.oldPromise) {
			this.oldPromise();
		}

		try {
			const results = await Promise.race([
				RocketChat.spotlight(keyword, [...rooms, ...this.roomsCache].map(r => r.name), { rooms: true }),
				new Promise((resolve, reject) => (this.oldPromise = reject))
			]);
			if (results.rooms && results.rooms.length) {
				this.roomsCache = [...this.roomsCache, ...results.rooms].filter(onlyUnique);
			}
			this.setState({ mentions: [...rooms.slice(), ...results.rooms] });
		} catch (e) {
			console.warn('spotlight canceled');
		} finally {
			delete this.oldPromise;
		}
	}

	getEmojis = (keyword) => {
		if (keyword) {
			this.customEmojis = database.objects('customEmojis').filtered('name CONTAINS[c] $0', keyword).slice(0, 4);
			this.emojis = emojis.filter(emoji => emoji.indexOf(keyword) !== -1).slice(0, 4);
			const mergedEmojis = [...this.customEmojis, ...this.emojis];
			this.setState({ mentions: mergedEmojis });
		}
	}

	focus = () => {
		if (this.component && this.component.focus) {
			this.component.focus();
		}
	}

	handleTyping = (isTyping) => {
		const { typing, rid } = this.props;
		if (!isTyping) {
			if (this.typingTimeout) {
				clearTimeout(this.typingTimeout);
				this.typingTimeout = false;
			}
			typing(rid, false);
			return;
		}

		if (this.typingTimeout) {
			return;
		}

		this.typingTimeout = setTimeout(() => {
			typing(rid, true);
			this.typingTimeout = false;
		}, 1000);
	}

	setTextInputRef(component) {
		this.component = component;
	}

	setInput = (text) => {
		this.text = text;
		if (this.component && this.component.setNativeProps) {
			this.component.setNativeProps({ text });
		}
	}

	setShowSend = (showSend) => {
		this.setState({ showSend });
	}

	clearInput = () => {
		this.setInput('');
		this.setShowSend(false);
	}

	toggleFilesActions = () => {
		this.setState(prevState => ({ showFilesAction: !prevState.showFilesAction }));
	}

	sendImageMessage = async(file) => {
		const { rid } = this.props;

		this.setState({ file: { isVisible: false } });
		const fileInfo = {
			name: file.name,
			description: file.description,
			size: file.size,
			type: file.mime,
			store: 'Uploads',
			path: file.path
		};
		try {
			await RocketChat.sendFileMessage(rid, fileInfo);
		} catch (e) {
			log('sendImageMessage', e);
		}
	}

	takePhoto = async() => {
		try {
			const image = await ImagePicker.openCamera(imagePickerConfig);
			this.showUploadModal(image);
		} catch (e) {
			log('takePhoto', e);
		}
	}

	chooseFromLibrary = async() => {
		try {
			const image = await ImagePicker.openPicker(imagePickerConfig);
			this.showUploadModal(image);
		} catch (e) {
			log('chooseFromLibrary', e);
		}
	}

	showUploadModal = (file) => {
		this.setState({ file: { ...file, isVisible: true } });
	}

	editCancel = () => {
		const { editCancel } = this.props;
		editCancel();
		this.clearInput();
	}

	openEmoji = async() => {
		await this.setState({
			showEmojiKeyboard: true
		});
	}

	recordAudioMessage = async() => {
		const recording = await Recording.permission();
		this.setState({ recording });
	}

	finishAudioMessage = async(fileInfo) => {
		const { rid } = this.props;

		this.setState({
			recording: false
		});
		if (fileInfo) {
			try {
				await RocketChat.sendFileMessage(rid, fileInfo);
			} catch (e) {
				if (e && e.error === 'error-file-too-large') {
					return Alert.alert(I18n.t(e.error));
				}
				log('finishAudioMessage', e);
			}
		}
	}

	closeEmoji = () => {
		this.setState({ showEmojiKeyboard: false });
	}

	submit = async() => {
		const {
			message: editingMessage, editRequest, onSubmit
		} = this.props;
		const message = this.text;

		this.closeEmoji();
		this.stopTrackingMention();
		this.handleTyping(false);
		if (message.trim() === '') {
			return;
		}
		// if is editing a message
		const {
			editing, replying
		} = this.props;

		if (editing) {
			const { _id, rid } = editingMessage;
			editRequest({ _id, msg: message, rid });
		} else if (replying) {
			const {
				user, replyMessage, roomType, closeReply
			} = this.props;
			const permalink = await this.getPermalink(replyMessage);
			let msg = `[ ](${ permalink }) `;

			// if original message wasn't sent by current user and neither from a direct room
			if (user.username !== replyMessage.u.username && roomType !== 'd' && replyMessage.mention) {
				msg += `@${ replyMessage.u.username } `;
			}

			msg = `${ msg } ${ message }`;
			onSubmit(msg);
			closeReply();
		} else {
			// if is submiting a new message
			onSubmit(message);
		}
		this.clearInput();
	}

	updateMentions = (keyword, type) => {
		if (type === MENTIONS_TRACKING_TYPE_USERS) {
			this.getUsers(keyword);
		} else if (type === MENTIONS_TRACKING_TYPE_EMOJIS) {
			this.getEmojis(keyword);
		} else {
			this.getRooms(keyword);
		}
	}

	identifyMentionKeyword = (keyword, type) => {
		this.setState({
			showEmojiKeyboard: false,
			trackingType: type
		});
		this.updateMentions(keyword, type);
	}

	stopTrackingMention = () => {
		const { trackingType } = this.state;
		if (!trackingType) {
			return;
		}

		this.setState({
			mentions: [],
			trackingType: ''
		});
		this.users = [];
		this.rooms = [];
		this.customEmojis = [];
		this.emojis = [];
	}

	renderFixedMentionItem = item => (
		<TouchableOpacity
			style={styles.mentionItem}
			onPress={() => this.onPressMention(item)}
		>
			<Text style={styles.fixedMentionAvatar}>{item.username}</Text>
			<Text style={styles.mentionText}>{item.username === 'here' ? I18n.t('Notify_active_in_this_room') : I18n.t('Notify_all_in_this_room')}</Text>
		</TouchableOpacity>
	)

	renderMentionEmoji = (item) => {
		const { baseUrl } = this.props;

		if (item.name) {
			return (
				<CustomEmoji
					key='mention-item-avatar'
					style={styles.mentionItemCustomEmoji}
					emoji={item}
					baseUrl={baseUrl}
				/>
			);
		}
		return (
			<Text
				key='mention-item-avatar'
				style={styles.mentionItemEmoji}
			>
				{emojify(`:${ item }:`, { output: 'unicode' })}
			</Text>
		);
	}

	renderMentionItem = (item) => {
		const { trackingType } = this.state;
		const { baseUrl, user } = this.props;

		if (item.username === 'all' || item.username === 'here') {
			return this.renderFixedMentionItem(item);
		}
		return (
			<TouchableOpacity
				style={styles.mentionItem}
				onPress={() => this.onPressMention(item)}
				testID={`mention-item-${ trackingType === MENTIONS_TRACKING_TYPE_EMOJIS ? item.name || item : item.username || item.name }`}
			>
				{trackingType === MENTIONS_TRACKING_TYPE_EMOJIS
					? [
						this.renderMentionEmoji(item),
						<Text key='mention-item-name' style={styles.mentionText}>:{ item.name || item }:</Text>
					]
					: [
						<Avatar
							key='mention-item-avatar'
							style={{ margin: 8 }}
							text={item.username || item.name}
							size={30}
							type={item.username ? 'd' : 'c'}
							baseUrl={baseUrl}
							user={user}
						/>,
						<Text key='mention-item-name' style={styles.mentionText}>{ item.username || item.name }</Text>
					]
				}
			</TouchableOpacity>
		);
	}

	renderMentions = () => {
		const { mentions, trackingType } = this.state;
		if (!trackingType) {
			return null;
		}
		return (
			<View key='messagebox-container' testID='messagebox-container'>
				<FlatList
					style={styles.mentionList}
					data={mentions}
					renderItem={({ item }) => this.renderMentionItem(item)}
					keyExtractor={item => item._id || item.username || item}
					keyboardShouldPersistTaps='always'
				/>
			</View>
		);
	};

	renderReplyPreview = () => {
		const {
			replyMessage, replying, closeReply, user
		} = this.props;
		if (!replying) {
			return null;
		}
		return <ReplyPreview key='reply-preview' message={replyMessage} close={closeReply} username={user.username} />;
	};

	renderFilesActions = () => {
		const { showFilesAction } = this.state;

		if (!showFilesAction) {
			return null;
		}
		return (
			<FilesActions
				key='files-actions'
				hideActions={this.toggleFilesActions}
				takePhoto={this.takePhoto}
				chooseFromLibrary={this.chooseFromLibrary}
			/>
		);
	}

	renderContent = () => {
		const { recording, showEmojiKeyboard, showSend } = this.state;
		const { editing } = this.props;

		if (recording) {
			return (<Recording onFinish={this.finishAudioMessage} />);
		}
		return (
			[
				this.renderMentions(),
				<MessageBoxContent
					editing={editing}
					recording={recording}
					setTextInputRef={this.setTextInputRef.bind(this)} // eslint-disable-line
					onChangeText={this.onChangeText}
					renderReplyPreview={this.renderReplyPreview}
					editCancel={this.editCancel}
					showEmojiKeyboard={showEmojiKeyboard}
					openEmoji={this.openEmoji}
					closeEmoji={this.closeEmoji}
					showSend={showSend}
					submit={this.submit}
					recordAudioMessage={this.recordAudioMessage}
					toggleFilesActions={this.toggleFilesActions}
					renderMentions={this.renderMentions}
					onKeyboardResigned={this.onKeyboardResigned}
					onEmojiSelected={this.onEmojiSelected}
				/>
			]
		);
	}

	render() {
		const { showEmojiKeyboard, file } = this.state;
		return (
			[
				isIOS ? this.renderContent() : (
					<KeyboardAccessoryView
						key='input'
						renderContent={this.renderContent}
						kbInputRef={this.component}
						kbComponent={showEmojiKeyboard ? 'EmojiKeyboard' : null}
						onKeyboardResigned={this.onKeyboardResigned}
						onItemSelected={this.onEmojiSelected}
						trackInteractive
						requiresSameParentToManageScrollView
						addBottomView
					/>
				),
				this.renderFilesActions(),
				<UploadModal
					key='upload-modal'
					isVisible={(file && file.isVisible)}
					file={file}
					close={() => this.setState({ file: {} })}
					submit={this.sendImageMessage}
				/>
			]
		);
	}
}

const mapStateToProps = state => ({
	message: state.messages.message,
	replyMessage: state.messages.replyMessage,
	replying: state.messages.replyMessage && !!state.messages.replyMessage.msg,
	editing: state.messages.editing,
	baseUrl: state.settings.Site_Url || state.server ? state.server.server : '',
	user: {
		id: state.login.user && state.login.user.id,
		username: state.login.user && state.login.user.username,
		token: state.login.user && state.login.user.token
	}
});

const dispatchToProps = ({
	editCancel: () => editCancelAction(),
	editRequest: message => editRequestAction(message),
	typing: (rid, status) => userTypingAction(rid, status),
	closeReply: () => replyCancelAction()
});

export default connect(mapStateToProps, dispatchToProps, null, { forwardRef: true })(MessageBox);
