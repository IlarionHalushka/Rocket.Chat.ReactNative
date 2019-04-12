import * as types from '../actions/actionsTypes';

const initialState = {
	isFetching: false,
	failure: false,
	message: {},
	actionMessage: {},
	replyMessage: {},
	editing: false,
	showActions: false,
	showErrorActions: false,
	showReactionPicker: false,
	showFilesModal: false,
	file: {}
};

export default function messages(state = initialState, action) {
	switch (action.type) {
		case types.MESSAGES.REQUEST:
			return {
				...state,
				isFetching: true
			};
		case types.MESSAGES.SUCCESS:
			return {
				...state,
				isFetching: false
			};
		case types.LOGIN.FAILURE:
			return {
				...state,
				isFetching: false,
				failure: true,
				errorMessage: action.err
			};
		case types.MESSAGES.ACTIONS_SHOW:
			return {
				...state,
				showActions: true,
				actionMessage: action.actionMessage
			};
		case types.MESSAGES.ACTIONS_HIDE:
			return {
				...state,
				showActions: false
			};
		case types.MESSAGES.ERROR_ACTIONS_SHOW:
			return {
				...state,
				showErrorActions: true,
				actionMessage: action.actionMessage
			};
		case types.MESSAGES.ERROR_ACTIONS_HIDE:
			return {
				...state,
				showErrorActions: false
			};
		case types.MESSAGES.EDIT_INIT:
			return {
				...state,
				message: action.message,
				editing: true
			};
		case types.MESSAGES.EDIT_CANCEL:
			return {
				...state,
				message: {},
				editing: false
			};
		case types.MESSAGES.EDIT_SUCCESS:
			return {
				...state,
				message: {},
				editing: false
			};
		case types.MESSAGES.EDIT_FAILURE:
			return {
				...state,
				message: {},
				editing: false
			};
		case types.MESSAGES.REPLY_INIT:
			return {
				...state,
				replyMessage: {
					...action.message,
					mention: action.mention
				}
			};
		case types.MESSAGES.REPLY_CANCEL:
			return {
				...state,
				replyMessage: {}
			};
		case types.MESSAGES.SET_INPUT:
			return {
				...state,
				message: action.message
			};
		case types.MESSAGES.CLEAR_INPUT:
			return {
				...state,
				message: {}
			};
		case types.MESSAGES.TOGGLE_REACTION_PICKER:
			return {
				...state,
				showReactionPicker: !state.showReactionPicker,
				actionMessage: action.message
			};
		case types.MESSAGES.OPEN_FILES_MODAL:
			return {
				...state,
				showFilesModal: true,
				file: JSON.parse(JSON.stringify(action.message))
			};
		case types.MESSAGES.CLOSE_FILES_MODAL:
			return {
				...state,
				showFilesModal: false
			};
		default:
			return state;
	}
}
